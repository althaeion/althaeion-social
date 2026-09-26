import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';

/**
 * Resolves `{{ path.to.value }}` against a run's accumulated context.
 *
 * The important method is `resolveStructured`. Templating a JSON body by
 * pasting values into the raw string is how a workflow gets corrupted by its
 * own data: an RSS title containing a quote, a newline or a brace silently
 * breaks the payload, and a hostile feed can inject fields into it. So the
 * caller hands over an already-parsed structure, only string LEAVES are
 * substituted, and the result is serialised afterwards — the value can then
 * contain anything at all and stays a value.
 */
@Injectable()
export class ExpressionResolver {
  private static readonly PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

  resolve(template: string, context: Record<string, any>): string {
    if (typeof template !== 'string' || !template.includes('{{')) {
      return template;
    }

    return template.replace(ExpressionResolver.PATTERN, (_full, path: string) =>
      this.resolveVariable(path, context)
    );
  }

  resolveStructured(value: any, context: Record<string, any>): any {
    if (typeof value === 'string') {
      return this.resolve(value, context);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveStructured(item, context));
    }

    if (value && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [key, item] of Object.entries(value)) {
        // Keys are templated too: a workflow that builds a header name or a
        // form field from earlier output is a normal thing to want.
        out[this.resolve(key, context)] = this.resolveStructured(item, context);
      }
      return out;
    }

    return value;
  }

  private resolveVariable(path: string, context: Record<string, any>): string {
    if (path === 'now') {
      return dayjs().toISOString();
    }

    if (path === 'today') {
      return dayjs().format('YYYY-MM-DD');
    }

    const value = this.dataGet(context, path);

    if (value === null || value === undefined) {
      // An unresolved placeholder becomes empty, never the literal "{{ x }}".
      // Leaving the braces in ships template syntax to a live audience.
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    try {
      return JSON.stringify(value) ?? '';
    } catch {
      // Circular structures are reachable here through HTTP node output.
      return '';
    }
  }

  /** Dotted lookup, array indices included: `items.0.title`. */
  private dataGet(context: Record<string, any>, path: string): any {
    return path.split('.').reduce<any>((acc, key) => {
      if (acc === null || acc === undefined) {
        return undefined;
      }
      // Guard against prototype walking: `{{ constructor.prototype }}` in a
      // template must not reach anything.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return acc[key];
    }, context);
  }
}
