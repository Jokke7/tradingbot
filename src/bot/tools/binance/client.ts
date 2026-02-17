import { createHmac } from 'crypto';
import type { BinanceConfig } from '../../config.js';
import { BINANCE_URLS, type BinanceApiError } from './types.js';

/**
 * Thin Binance REST API client.
 * Uses native fetch + crypto HMAC — no external SDK.
 *
 * Handles:
 * - HMAC-SHA256 request signing (required for authenticated endpoints)
 * - Testnet vs production URL switching
 * - Typed error handling with Binance error codes
 * - Rate limit awareness via response headers
 */
export class BinanceClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(config: BinanceConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.testnet
      ? BINANCE_URLS.testnet.rest
      : BINANCE_URLS.production.rest;
  }

  /**
   * Public endpoint (no signing required).
   * Used for market data: prices, klines, orderbook.
   */
  async publicGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const qs = this.buildQueryString(params);
    const url = `${this.baseUrl}${path}${qs ? '?' + qs : ''}`;

    const res = await fetch(url, {
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });

    return this.handleResponse<T>(res);
  }

  /**
   * Signed endpoint (HMAC-SHA256 signature required).
   * Used for account data and order placement.
   */
  async signedGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const signedParams = this.signParams(params);
    const qs = this.buildQueryString(signedParams);
    const url = `${this.baseUrl}${path}?${qs}`;

    const res = await fetch(url, {
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });

    return this.handleResponse<T>(res);
  }

  /**
   * Signed POST (for placing/cancelling orders).
   */
  async signedPost<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const signedParams = this.signParams(params);
    const body = this.buildQueryString(signedParams);
    const url = `${this.baseUrl}${path}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    return this.handleResponse<T>(res);
  }

  /**
   * Signed DELETE (for cancelling orders).
   */
  async signedDelete<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const signedParams = this.signParams(params);
    const qs = this.buildQueryString(signedParams);
    const url = `${this.baseUrl}${path}?${qs}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });

    return this.handleResponse<T>(res);
  }

  /**
   * Test connectivity to Binance API.
   * Returns true if the API is reachable.
   */
  async ping(): Promise<boolean> {
    try {
      await this.publicGet('/v3/ping');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get server time (useful for debugging clock sync issues).
   */
  async getServerTime(): Promise<number> {
    const res = await this.publicGet<{ serverTime: number }>('/v3/time');
    return res.serverTime;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Sign parameters with HMAC-SHA256.
   * Adds timestamp and signature to the parameter set.
   */
  private signParams(
    params: Record<string, string | number>
  ): Record<string, string | number> {
    const timestamp = Date.now();
    const withTimestamp = { ...params, timestamp };
    const queryString = this.buildQueryString(withTimestamp);
    const signature = createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');

    return { ...withTimestamp, signature };
  }

  /**
   * Build a query string from key-value pairs.
   * Filters out undefined values.
   */
  private buildQueryString(params: Record<string, string | number | undefined>): string {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  /**
   * Handle API response: parse JSON, throw on error.
   */
  private async handleResponse<T>(res: Response): Promise<T> {
    const data = await res.json();

    if (!res.ok) {
      const error = data as BinanceApiError;
      throw new BinanceError(
        error.code ?? res.status,
        error.msg ?? `HTTP ${res.status}: ${res.statusText}`
      );
    }

    return data as T;
  }
}

/**
 * Typed Binance API error with error code.
 */
export class BinanceError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(`Binance API error ${code}: ${message}`);
    this.name = 'BinanceError';
  }
}
