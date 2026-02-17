import { describe, it, expect } from 'bun:test';
import { rsi } from '../../src/bot/utils/indicators.js';
import { sma } from '../../src/bot/utils/indicators.js';
import { ema } from '../../src/bot/utils/indicators.js';
import { macd } from '../../src/bot/utils/indicators.js';

describe('RSI calculation', () => {
  it('returns correct value for known input', () => {
    const prices = [
      44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89,
      46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64, 46.21,
      46.25, 45.71, 46.33, 45.64, 45.21, 46.22, 45.64, 45.81, 46.15, 45.93,
    ];
    const result = rsi(prices, 14);
    expect(result).toBeGreaterThan(40);
    expect(result).toBeLessThan(80);
  });

  it('returns 50 for neutral prices', () => {
    const prices = Array(30).fill(100).map((v, i) => v + (i % 2 === 0 ? 0.1 : -0.1));
    const result = rsi(prices, 14);
    expect(result).toBeGreaterThan(40);
    expect(result).toBeLessThan(60);
  });

  it('returns NaN for insufficient data', () => {
    const prices = [100, 101, 102];
    const result = rsi(prices, 14);
    expect(result).toBeNaN();
  });

  it('returns oversold for declining prices', () => {
    const prices = Array(30).fill(100).map((v, i) => v - i);
    const result = rsi(prices, 14);
    expect(result).toBeLessThan(30);
  });

  it('returns overbought for rising prices', () => {
    const prices = Array(30).fill(100).map((v, i) => v + i);
    const result = rsi(prices, 14);
    expect(result).toBeGreaterThan(70);
  });

  it('returns value between 0 and 100', () => {
    const prices = Array(50).fill(100).map((v, i) => v + Math.sin(i / 3) * 20);
    const result = rsi(prices, 14);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});

describe('SMA calculation', () => {
  it('calculates correct SMA for last N prices', () => {
    const prices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(sma(prices, 5)).toBe(8);
    expect(sma(prices, 10)).toBe(5.5);
  });

  it('returns last price for period 1', () => {
    const prices = [1, 2, 3, 4, 5];
    expect(sma(prices, 1)).toBe(5);
  });

  it('returns NaN for insufficient data', () => {
    const prices = [1, 2];
    expect(sma(prices, 5)).toBeNaN();
  });

  it('returns NaN for empty array', () => {
    expect(sma([], 5)).toBeNaN();
  });

  it('handles period equal to array length', () => {
    const prices = [1, 2, 3, 4, 5];
    expect(sma(prices, 5)).toBe(3);
  });
});

describe('EMA calculation', () => {
  it('calculates EMA for known data', () => {
    const prices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = ema(prices, 10);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });

  it('returns NaN for insufficient data', () => {
    const prices = [1, 2, 3];
    const result = ema(prices, 10);
    expect(result).toBeNaN();
  });

  it('approaches current price for longer periods on trending data', () => {
    const prices = Array(50).fill(100);
    const shortEma = ema(prices, 10);
    const longEma = ema(prices, 30);
    expect(shortEma).toBe(100);
    expect(longEma).toBeCloseTo(100);
  });
});

describe('MACD calculation', () => {
  it('returns valid MACD values', () => {
    const prices = Array(50).fill(100).map((v, i) => v + Math.sin(i / 5) * 10);
    const result = macd(prices);
    expect(result.macd).toBeDefined();
    expect(result.signal).toBeDefined();
    expect(result.histogram).toBeDefined();
    expect(typeof result.macd).toBe('number');
    expect(typeof result.signal).toBe('number');
    expect(typeof result.histogram).toBe('number');
  });

  it('handles insufficient data', () => {
    const prices = [100, 101, 102];
    const result = macd(prices);
    expect(result.macd).toBeNaN();
    expect(result.signal).toBeNaN();
  });

  it('calculates histogram as macd - signal', () => {
    const prices = Array(50).fill(100).map((v, i) => v + i);
    const result = macd(prices);
    expect(result.histogram).toBeCloseTo(result.macd - result.signal);
  });

  it('returns valid structure for trending up prices', () => {
    const prices = Array(50).fill(100).map((v, i) => v + i);
    const result = macd(prices);
    expect(result.macd).toBeGreaterThan(0);
    expect(Math.abs(result.histogram)).toBeLessThan(1);
  });

  it('returns valid structure for trending down prices', () => {
    const prices = Array(50).fill(100).map((v, i) => v - i);
    const result = macd(prices);
    expect(result.macd).toBeLessThan(0);
    expect(Math.abs(result.histogram)).toBeLessThan(1);
  });
});
