import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { sma, ema } from '../../utils/indicators.js';
import { BinanceClient } from '../binance/client.js';

/**
 * Moving average calculation tool.
 * Computes SMA and EMA and detects crossover signals.
 */
export function createMovingAverageTool(client: BinanceClient) {
  return new DynamicStructuredTool({
    name: 'calculate_moving_averages',
    description:
      'Calculate Simple Moving Average (SMA) and Exponential Moving Average (EMA) ' +
      'for a Binance trading pair. Detects golden cross (SMA20 > SMA50, bullish) ' +
      'and death cross (SMA20 < SMA50, bearish) signals.',
    schema: z.object({
      symbol: z.string().describe("Trading pair symbol, e.g. 'BTCUSDT'"),
      interval: z
        .enum(['5m', '15m', '1h', '4h', '1d'])
        .default('1h')
        .describe("Candle interval. Default '1h'."),
    }),
    func: async ({ symbol, interval }) => {
      const raw = await client.publicGet<unknown[][]>('/v3/klines', {
        symbol: symbol.toUpperCase(),
        interval,
        limit: 100,
      });

      const closePrices = raw.map((k) => parseFloat(k[4] as string));
      const currentPrice = closePrices[closePrices.length - 1];

      const sma20 = sma(closePrices, 20);
      const sma50 = sma(closePrices, 50);
      const ema12 = ema(closePrices, 12);
      const ema26 = ema(closePrices, 26);

      // Detect crossover signal
      let crossoverSignal: 'golden_cross' | 'death_cross' | 'none' = 'none';
      if (!isNaN(sma20) && !isNaN(sma50)) {
        if (sma20 > sma50) crossoverSignal = 'golden_cross';
        else if (sma20 < sma50) crossoverSignal = 'death_cross';
      }

      // Price relative to moving averages
      const aboveSma20 = currentPrice > sma20;
      const aboveSma50 = currentPrice > sma50;

      return JSON.stringify({
        symbol: symbol.toUpperCase(),
        interval,
        currentPrice: currentPrice.toFixed(2),
        sma20: isNaN(sma20) ? 'insufficient data' : sma20.toFixed(2),
        sma50: isNaN(sma50) ? 'insufficient data' : sma50.toFixed(2),
        ema12: isNaN(ema12) ? 'insufficient data' : ema12.toFixed(2),
        ema26: isNaN(ema26) ? 'insufficient data' : ema26.toFixed(2),
        crossoverSignal,
        priceAboveSma20: aboveSma20,
        priceAboveSma50: aboveSma50,
        interpretation:
          crossoverSignal === 'golden_cross'
            ? 'SMA20 above SMA50 — bullish trend (golden cross).'
            : crossoverSignal === 'death_cross'
              ? 'SMA20 below SMA50 — bearish trend (death cross).'
              : 'No clear crossover signal.',
      });
    },
  });
}
