import { Injectable } from '@nestjs/common';
import { SafeHttpFetcher } from '@gitroom/nestjs-libraries/services/safe.http.fetcher';

export interface LinkCard {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

/**
 * Reads a URL's Open Graph card.
 *
 * Bluesky and Mastodon do not unfurl links themselves — a post with a bare URL
 * shows a bare URL, while the same post on X shows a picture and a headline. To
 * attach a card the app has to fetch the page and read its meta tags, which is
 * exactly the operation an SSRF wants, so it goes through SafeHttpFetcher.
 */
@Injectable()
export class LinkCardService {
  constructor(private _safeHttpFetcher: SafeHttpFetcher) {}

  async fetch(url: string): Promise<LinkCard | null> {
    let page: { body: string; finalUrl: string; contentType: string };
    try {
      page = await this._safeHttpFetcher.get(url);
    } catch {
      // A link card is a nicety. A URL that will not load must not stop the
      // post it was pasted into from being written.
      return null;
    }

    if (!/text\/html/i.test(page.contentType)) {
      return null;
    }

    const head = page.body.slice(0, 200000);

    const title =
      this.meta(head, 'og:title') ||
      this.meta(head, 'twitter:title') ||
      this.tag(head, 'title');

    const description =
      this.meta(head, 'og:description') ||
      this.meta(head, 'twitter:description') ||
      this.metaName(head, 'description');

    const image = this.meta(head, 'og:image') || this.meta(head, 'twitter:image');

    return {
      url: page.finalUrl,
      title: this.decode(title),
      description: this.decode(description),
      // Resolved against the URL actually landed on, not the one typed: a site
      // that redirects to a CDN host would otherwise resolve /cover.jpg against
      // the wrong origin and produce a dead image.
      image: image ? this.absolute(image, page.finalUrl) : null,
      siteName: this.decode(this.meta(head, 'og:site_name')),
      favicon: this.absolute('/favicon.ico', page.finalUrl),
    };
  }

  private meta(html: string, property: string): string | null {
    // Attribute order is not fixed in the wild, so match either way round.
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'),
      new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }

    return null;
  }

  private metaName(html: string, name: string): string | null {
    const match = html.match(
      new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i')
    );
    return match?.[1] || null;
  }

  private tag(html: string, tag: string): string | null {
    const match = html.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return match?.[1]?.trim() || null;
  }

  private absolute(candidate: string, base: string): string | null {
    try {
      return new URL(candidate, base).toString();
    } catch {
      return null;
    }
  }

  private decode(value: string | null): string | null {
    if (!value) return null;
    return value
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
