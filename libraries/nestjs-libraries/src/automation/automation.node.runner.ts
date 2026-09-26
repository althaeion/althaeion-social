import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import Parser from 'rss-parser';
import { ExpressionResolver } from '@gitroom/nestjs-libraries/automation/expression.resolver';
import {
  AUTOMATION_LIMITS,
  AutomationNode,
  ConditionOperator,
  NodeResult,
} from '@gitroom/nestjs-libraries/automation/automation.types';
import { SafeHttpFetcher } from '@gitroom/nestjs-libraries/services/safe.http.fetcher';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.service';
import { ContentEditorService } from '@gitroom/nestjs-libraries/openai/content.editor.service';
import { AutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/automation/automation.repository';

const parser = new Parser();

/**
 * Runs one node and reports what it produced.
 *
 * Deliberately knows nothing about graphs, edges or persistence — the engine
 * owns those. A node here is a pure-ish step: context in, output out, plus an
 * optional branch or resume instruction.
 */
@Injectable()
export class AutomationNodeRunner {
  constructor(
    private _expressionResolver: ExpressionResolver,
    private _safeHttpFetcher: SafeHttpFetcher,
    private _openaiService: OpenaiService,
    private _brandService: BrandService,
    private _contentEditorService: ContentEditorService,
    private _automationRepository: AutomationRepository
  ) {}

  async run(
    orgId: string,
    node: AutomationNode,
    context: Record<string, any>,
    automationId?: string
  ): Promise<NodeResult> {
    switch (node.type) {
      case 'TRIGGER':
        return { output: {} };

      case 'END':
        return { output: {}, halt: true };

      case 'DELAY':
        return this.delay(node);

      case 'CONDITION':
        return this.condition(node, context);

      case 'GENERATE':
        return this.generate(orgId, node, context);

      case 'FETCH_RSS':
        return this.fetchRss(node, context, automationId);

      case 'HTTP_REQUEST':
        return this.httpRequest(node, context, false);

      case 'WEBHOOK':
        return this.httpRequest(node, context, true);

      case 'PUBLISH':
        // The engine owns publishing: it needs the posts service and the run's
        // organisation, and a node runner that could publish would be a node
        // runner that could publish from a test harness.
        return { output: { publish: true } };

      default:
        throw new Error(`Unknown step type: ${(node as AutomationNode).type}`);
    }
  }

  private delay(node: AutomationNode): NodeResult {
    const amount = Number(node.config?.amount || 0);
    const unit = (node.config?.unit || 'minutes') as 'minutes' | 'hours' | 'days';
    const resumeAt = dayjs().add(amount, unit).toDate();

    return { output: { resumeAt: resumeAt.toISOString() }, resumeAt };
  }

  private condition(node: AutomationNode, context: Record<string, any>): NodeResult {
    const left = this._expressionResolver.resolve(String(node.config?.left ?? ''), context);
    const right = this._expressionResolver.resolve(String(node.config?.right ?? ''), context);
    const operator = node.config?.operator as ConditionOperator;
    const caseSensitive = !!node.config?.caseSensitive;

    const a = caseSensitive ? left : left.toLowerCase();
    const b = caseSensitive ? right : right.toLowerCase();

    let passed: boolean;
    switch (operator) {
      case 'contains':
        passed = a.includes(b);
        break;
      case 'not_contains':
        passed = !a.includes(b);
        break;
      case 'equals':
        passed = a === b;
        break;
      case 'not_equals':
        passed = a !== b;
        break;
      case 'matches':
        passed = this.safeMatch(left, right, caseSensitive);
        break;
      case 'greater_than':
        passed = this.compareNumbers(left, right, (x, y) => x > y);
        break;
      case 'less_than':
        passed = this.compareNumbers(left, right, (x, y) => x < y);
        break;
      default:
        throw new Error(`Unknown comparison: ${operator}`);
    }

    return { output: { left, right, operator, passed }, branch: passed ? 'yes' : 'no' };
  }

  /**
   * A pattern that came from a text box can backtrack catastrophically, and the
   * engine runs unattended — a wedged regex would hold the worker, not a user's
   * browser. The comparison is capped rather than trusted.
   */
  private safeMatch(value: string, pattern: string, caseSensitive: boolean): boolean {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseSensitive ? '' : 'i');
    } catch {
      return false;
    }

    const started = Date.now();
    const result = regex.test(value.slice(0, 10000));
    const elapsed = Date.now() - started;

    if (elapsed > 250) {
      console.warn('[automation] a condition pattern took an unusually long time', {
        pattern,
        elapsed,
      });
    }

    return result;
  }

  /**
   * Both sides must be numbers. Falling back to string comparison would make
   * "10" < "9" true, which is the kind of quiet wrongness a workflow author
   * never finds.
   */
  private compareNumbers(left: string, right: string, cmp: (a: number, b: number) => boolean) {
    const a = Number(left);
    const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return false;
    }
    return cmp(a, b);
  }

  private async generate(
    orgId: string,
    node: AutomationNode,
    context: Record<string, any>
  ): Promise<NodeResult> {
    const prompt = this._expressionResolver.resolve(String(node.config?.prompt ?? ''), context);
    const brand = await this._brandService.prompt(orgId);

    const posts = await this._openaiService.generatePosts(
      brand ? `${brand}\n\n${prompt}` : prompt
    );

    let content = Array.isArray(posts) ? posts[0]?.content ?? '' : String(posts ?? '');

    // Same second pass the composer offers. A workflow that posts unattended is
    // exactly where unedited model prose does the most damage.
    if (node.config?.humanize !== false && content) {
      content = await this._contentEditorService.humanize(orgId, content, node.config?.platform);
    }

    return { output: { content, generated: posts } };
  }

  /**
   * `automationId` is threaded in so the node can read and advance its watermark
   * — the newest item date it has already handled. Without that, every fire
   * re-reads the whole feed and the workflow either republishes old items or
   * needs an ever-growing dedupe list to avoid it.
   */
  private async fetchRss(
    node: AutomationNode,
    context: Record<string, any>,
    automationId?: string
  ): Promise<NodeResult> {
    const url = this._expressionResolver.resolve(String(node.config?.url ?? ''), context);

    // Re-checked at call time even though the validator checked it at save
    // time: the hostname's DNS can be repointed at a private address in between.
    await this._safeHttpFetcher.assertSafe(url);
    const { body } = await this._safeHttpFetcher.get(url);
    const feed = await parser.parseString(body);

    const all = (feed.items || [])
      .map((item) => ({
        // `guid` first: a feed that edits a title or moves a link still means
        // the same item, and re-posting it is the classic RSS automation bug.
        id: item.guid || item.link || item.title || '',
        title: item.title || '',
        link: item.link || '',
        content: item.contentSnippet || item.content || '',
        publishedAt: item.isoDate || item.pubDate || null,
      }))
      .filter((item) => item.id);

    const state = automationId
      ? await this._automationRepository.nodeState(automationId, node.id)
      : {};
    const watermark = state.last_item_date ? new Date(state.last_item_date) : null;

    const fresh = watermark
      ? all.filter((item) => item.publishedAt && new Date(item.publishedAt) > watermark)
      : all;

    const items = fresh.slice(0, AUTOMATION_LIMITS.MAX_RSS_ITEMS_PER_RUN);

    // Advance the watermark past everything SEEN this fetch, not just the slice
    // that was returned — otherwise the items beyond the per-run cap would be
    // re-read forever and the node could never catch up on a busy feed.
    const newest = all
      .map((item) => (item.publishedAt ? new Date(item.publishedAt) : null))
      .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    if (automationId && newest) {
      await this._automationRepository.saveNodeState(automationId, node.id, {
        last_item_date: newest.toISOString(),
      });
    }

    return {
      output: {
        feedTitle: feed.title || '',
        items,
        count: items.length,
        first: items[0] ?? null,
        // A first poll against a busy feed would otherwise fire the workflow
        // once per historical item; the caller can use this to skip that.
        firstPoll: !watermark,
      },
    };
  }

  private async httpRequest(
    node: AutomationNode,
    context: Record<string, any>,
    isWebhook: boolean
  ): Promise<NodeResult> {
    const config = node.config || {};
    const url = this._expressionResolver.resolve(String(config.url ?? ''), context);
    const method = (isWebhook ? 'POST' : config.method || 'GET').toUpperCase();

    await this._safeHttpFetcher.assertSafe(url);

    const headers: Record<string, string> = {
      'User-Agent': SafeHttpFetcher.USER_AGENT,
      ...this._expressionResolver.resolveStructured(config.headers || {}, context),
    };

    const auth = config.auth || { type: 'none' };
    if (auth.type === 'bearer') {
      headers.Authorization = `Bearer ${this._expressionResolver.resolve(String(auth.token ?? ''), context)}`;
    } else if (auth.type === 'basic') {
      const user = this._expressionResolver.resolve(String(auth.username ?? ''), context);
      const pass = this._expressionResolver.resolve(String(auth.password ?? ''), context);
      headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    } else if (auth.type === 'api_key') {
      headers[String(auth.header || 'X-API-Key')] = this._expressionResolver.resolve(
        String(auth.value ?? ''),
        context
      );
    }

    let payload: string | undefined;
    if (method !== 'GET' && method !== 'DELETE') {
      // Resolve the DECODED body, then serialise. Templating the JSON string
      // would let a feed title containing a quote break the payload — or inject
      // fields into it.
      const body = this._expressionResolver.resolveStructured(config.body ?? {}, context);
      payload = JSON.stringify(body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTOMATION_LIMITS.HTTP_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: payload,
        redirect: 'manual',
        signal: controller.signal,
      });

      const text = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        // Not JSON; `body` still carries the text.
      }

      const result: NodeResult = {
        output: { status: response.status, ok: response.ok, body: text.slice(0, 100000), json },
      };

      // A webhook is fire-and-report: a 500 from the receiver is information,
      // not a reason to fail the workflow. An HTTP_REQUEST node is a step in a
      // chain, so a failure there does stop the run.
      if (!isWebhook && !response.ok) {
        throw new Error(`The request returned ${response.status}.`);
      }

      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
