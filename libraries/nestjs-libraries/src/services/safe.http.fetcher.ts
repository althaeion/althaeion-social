import { Injectable } from '@nestjs/common';
import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';
import { isBlockedIp } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

/**
 * The single door for outbound HTTP to a URL a user supplied — brand autofill,
 * RSS triggers, workflow HTTP requests, link cards.
 *
 * `IsSafeWebhookUrl` already guards webhook URLs at the DTO boundary, and this
 * reuses its `isBlockedIp` ranges so there is one list of blocked networks, not
 * two that drift. What it adds is the part a one-shot validator cannot do:
 * redirects are followed BY HAND, and every hop is re-resolved and re-checked
 * before it is requested. A public page is allowed to answer 302 to
 * http://169.254.169.254/ — with automatic redirect following the fetch happens
 * before anyone can object, and the cloud metadata endpoint answers.
 */
@Injectable()
export class SafeHttpFetcher {
  public static readonly USER_AGENT = 'Mozilla/5.0 (compatible; LinkPreview/1.0)';
  public static readonly TIMEOUT_MS = 10000;
  public static readonly MAX_REDIRECTS = 3;
  /** Enough for a page's <head>; a brand autofill never needs the whole site. */
  public static readonly MAX_BYTES = 2 * 1024 * 1024;

  /** `example.com` is what people type; `https://example.com` is what fetches. */
  normalizeUrl(url: string): string {
    const trimmed = (url || '').trim();
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  async assertSafe(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(this.normalizeUrl(rawUrl));
    } catch {
      throw new Error('The URL could not be read.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http and https URLs can be fetched.');
    }

    // Credentials in the URL are a redirect-laundering trick more often than a
    // real need, and nothing here ever wants them.
    if (parsed.username || parsed.password) {
      throw new Error('URLs with embedded credentials are not allowed.');
    }

    const host = parsed.hostname.replace(/^\[|\]$/g, '');

    // A literal IP never reaches DNS, so check it directly.
    if (net.isIP(host)) {
      if (isBlockedIp(host)) {
        throw new Error('That address is on a private or reserved network.');
      }
      return parsed;
    }

    let addresses: { address: string }[];
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch {
      throw new Error('That hostname could not be resolved.');
    }

    if (!addresses.length) {
      throw new Error('That hostname could not be resolved.');
    }

    // EVERY address, not just the first: a host that resolves to one public and
    // one private address would otherwise pass the check and connect privately.
    if (addresses.some((a) => isBlockedIp(a.address))) {
      throw new Error('That address is on a private or reserved network.');
    }

    return parsed;
  }

  /**
   * GET a user-supplied URL. Returns the body as text plus the URL actually
   * landed on, so callers resolving relative links (og:image, RSS entries) use
   * the final host rather than the one that was typed.
   */
  async get(url: string): Promise<{ body: string; finalUrl: string; status: number; contentType: string }> {
    let current = this.normalizeUrl(url);

    for (let hop = 0; hop <= SafeHttpFetcher.MAX_REDIRECTS; hop++) {
      await this.assertSafe(current);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SafeHttpFetcher.TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': SafeHttpFetcher.USER_AGENT, Accept: '*/*' },
        });
      } catch (err: any) {
        throw new Error(`That URL could not be reached: ${err?.message || 'connection failed'}`);
      } finally {
        clearTimeout(timer);
      }

      const location = response.headers.get('location');
      const isRedirect = response.status >= 300 && response.status < 400 && !!location;

      if (isRedirect && hop < SafeHttpFetcher.MAX_REDIRECTS) {
        current = new URL(location!, current).toString();
        continue;
      }

      if (isRedirect) {
        throw new Error('That URL redirected too many times.');
      }

      return {
        body: await this.readCapped(response),
        finalUrl: current,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
      };
    }

    throw new Error('That URL redirected too many times.');
  }

  /**
   * Read at most MAX_BYTES. `response.text()` would happily buffer a multi-GB
   * body a hostile URL is streaming and take the process down with it.
   */
  private async readCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      return '';
    }

    const chunks: Uint8Array[] = [];
    let size = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      size += value.length;
      if (size > SafeHttpFetcher.MAX_BYTES) {
        chunks.push(value.slice(0, value.length - (size - SafeHttpFetcher.MAX_BYTES)));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
  }
}
