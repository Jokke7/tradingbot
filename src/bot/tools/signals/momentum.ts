import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { macd, roc, bollingerBands } from '../../utils/indicators.js';
import { BinanceClient } from '../binance/client.js';

/**
 * Momentum indicators tool.
 * Computes MACD, ROC, and Bollinger Bands for a trading pair.
 */
export function createMomentumTool(client: BinanceClient) {
  return new DynamicStructuredTool({
    name: 'calculate_momentum',
    description:
      'Calculate momentum indicators for a Binance trading pair: MACD, Rate of Change (ROC), ' +
      'and Bollinger Bands. Provides a comprehensive view of trend strength and potential reversals.',
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

      const macdResult = macd(closePrices);
      const rocValue = roc(closePrices, 10);
      const bb = bollingerBands(closePrices);

      // Bollinger Band position (0 = lower, 0.5 = middle, 1 = upper)
      const bbPosition = !isNaN(bb.upper) && !isNaN(bb.lower) && bb.upper !== bb.lower
        ? (currentPrice - bb.lower) / (bb.upper - bb.lower)
        : NaN;

      // Aggregate momentum signal
      let momentumSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      const bullishSignals: string[] = [];
      const bearishSignals: string[] = [];

      if (!isNaN(macdResult.histogram)) {
        if (macdResult.histogram > 0) bullishSignals.push('MACD histogram positive');
        else bearishSignals.push('MACD histogram negative');
      }
      if (!isNaN(rocValue)) {
        if (rocValue > 2) bullishSignals.push(`ROC +${rocValue.toFixed(1)}%`);
        else if (rocValue < -2) bearishSignals.push(`ROC ${rocValue.toFixed(1)}%`);
      }
      if (!isNaN(bbPosition)) {
        if (bbPosition < 0.1) bullishSignals.push('Near lower Bollinger Band (potential bounce)');
        else if (bbPosition > 0.9) bearishSignals.push('Near upper Bollinger Band (potential pullback)');
      }

      if (bullishSignals.length > bearishSignals.length) momentumSignal = 'bullish';
      else if (bearishSignals.length > bullishSignals.length) momentumSignal = 'bearish';

      return JSON.stringify({
        symbol: symbol.toUpperCase(),
        interval,
        currentPrice: currentPrice.toFixed(2),
        macd: {
          line: isNaN(macdResult.macd) ? null : parseFloat(macdResult.macd.toFixed(2)),
          signal: isNaN(macdResult.signal) ? null : parseFloat(macdResult.signal.toFixed(2)),
          histogram: isNaN(macdResult.histogram) ? null : parseFloat(macdResult.histogram.toFixed(2)),
        },
        roc10: isNaN(rocValue) ? null : parseFloat(rocValue.toFixed(2)),
        bollingerBands: {
          upper: isNaN(bb.upper) ? null : parseFloat(bb.upper.toFixed(2)),
          middle: isNaN(bb.middle) ? null : parseFloat(bb.middle.toFixed(2)),
          lower: isNaN(bb.lower) ? null : parseFloat(bb.lower.toFixed(2)),
          position: isNaN(bbPosition) ? null : parseFloat(bbPosition.toFixed(2)),
        },
        momentumSignal,
        bullishSignals,
        bearishSignals,
      });
    },
  });
}
