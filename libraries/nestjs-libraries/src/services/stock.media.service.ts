import { Injectable } from '@nestjs/common';

export interface StockAsset {
  id: string;
  source: 'unsplash' | 'giphy';
  thumb: string;
  url: string;
  width: number;
  height: number;
  alt: string;
  credit: string | null;
  creditUrl: string | null;
}

/**
 * Stock imagery inside the composer.
 *
 * The alternative is a tab-out to a stock site, a download, and an upload — the
 * point at which people post without a picture. Both providers have a free
 * tier, and both are optional: if the key is missing the search returns nothing
 * rather than throwing, so a self-hosted install without keys still composes.
 */
@Injectable()
export class StockMediaService {
  private readonly unsplashKey = process.env.UNSPLASH_ACCESS_KEY || '';
  private readonly giphyKey = process.env.GIPHY_API_KEY || '';

  get available() {
    return { unsplash: !!this.unsplashKey, giphy: !!this.giphyKey };
  }

  async search(query: string, source: 'unsplash' | 'giphy', page = 1): Promise<StockAsset[]> {
    const term = (query || '').trim();
    if (!term) {
      return [];
    }

    return source === 'giphy' ? this.giphy(term, page) : this.unsplash(term, page);
  }

  private async unsplash(query: string, page: number): Promise<StockAsset[]> {
    if (!this.unsplashKey) {
      return [];
    }

    const url =
      `https://api.unsplash.com/search/photos?per_page=24&page=${page}` +
      `&query=${encodeURIComponent(query)}`;

    const data = await this.json(url, { Authorization: `Client-ID ${this.unsplashKey}` });

    return (data?.results || []).map((photo: any) => ({
      id: String(photo.id),
      source: 'unsplash' as const,
      thumb: photo.urls?.small,
      url: photo.urls?.regular,
      width: photo.width,
      height: photo.height,
      alt: photo.alt_description || query,
      // Unsplash's licence requires attribution. Carrying it on the asset means
      // the UI can honour it without the caller having to remember.
      credit: photo.user?.name || null,
      creditUrl: photo.user?.links?.html || null,
    }));
  }

  private async giphy(query: string, page: number): Promise<StockAsset[]> {
    if (!this.giphyKey) {
      return [];
    }

    const limit = 24;
    const url =
      `https://api.giphy.com/v1/gifs/search?api_key=${this.giphyKey}` +
      `&limit=${limit}&offset=${(page - 1) * limit}&rating=pg-13` +
      `&q=${encodeURIComponent(query)}`;

    const data = await this.json(url);

    return (data?.data || []).map((gif: any) => ({
      id: String(gif.id),
      source: 'giphy' as const,
      thumb: gif.images?.fixed_width_small?.url,
      url: gif.images?.original?.url,
      width: Number(gif.images?.original?.width || 0),
      height: Number(gif.images?.original?.height || 0),
      alt: gif.title || query,
      credit: gif.username || null,
      creditUrl: gif.url || null,
    }));
  }

  /**
   * Both providers are optional extras in the composer, so a provider outage
   * returns an empty result rather than an error the user has to dismiss.
   */
  private async json(url: string, headers: Record<string, string> = {}): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        console.error('[stock-media] provider refused the search', { status: response.status });
        return null;
      }
      return await response.json();
    } catch (err) {
      console.error('[stock-media] search failed', { error: (err as Error)?.message });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
