import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { BinanceClient } from '../binance/client.js';
import type { AccountInfo, PriceTicker } from '../binance/types.js';

/**
 * Portfolio summary tool.
 * Aggregates balances with current prices to show total value and P&L.
 */
export function createPortfolioSummaryTool(client: BinanceClient) {
  return new DynamicStructuredTool({
    name: 'get_portfolio_summary',
    description:
      'Get a summary of the current Binance portfolio: all holdings, their USD value, ' +
      'and total portfolio value. Essential to check before making any trade.',
    schema: z.object({}),
    func: async () => {
      const account = await client.signedGet<AccountInfo>('/v3/account');
      const nonZero = account.balances.filter(
        (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
      );

      // Get prices for all held assets (except stablecoins)
      const stablecoins = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD']);
      const holdings: Array<{
        asset: string;
        quantity: number;
        usdValue: number;
        priceUsd: number | null;
      }> = [];

      let totalUsdValue = 0;

      for (const balance of nonZero) {
        const total = parseFloat(balance.free) + parseFloat(balance.locked);

        if (stablecoins.has(balance.asset)) {
          // Stablecoins: 1:1 USD value
          holdings.push({
            asset: balance.asset,
            quantity: total,
            usdValue: total,
            priceUsd: 1,
          });
          totalUsdValue += total;
        } else {
          // Non-stablecoins: fetch price
          try {
            const ticker = await client.publicGet<PriceTicker>('/v3/ticker/price', {
              symbol: `${balance.asset}USDT`,
            });
            const price = parseFloat(ticker.price);
            const value = total * price;
            holdings.push({
              asset: balance.asset,
              quantity: total,
              usdValue: value,
              priceUsd: price,
            });
            totalUsdValue += value;
          } catch {
            // Pair might not exist (e.g., some dust tokens)
            holdings.push({
              asset: balance.asset,
              quantity: total,
              usdValue: 0,
              priceUsd: null,
            });
          }
        }
      }

      // Sort by USD value descending
      holdings.sort((a, b) => b.usdValue - a.usdValue);

      return JSON.stringify({
        totalUsdValue: parseFloat(totalUsdValue.toFixed(2)),
        holdingsCount: holdings.length,
        holdings: holdings.map((h) => ({
          asset: h.asset,
          quantity: parseFloat(h.quantity.toFixed(8)),
          priceUsd: h.priceUsd !== null ? parseFloat(h.priceUsd.toFixed(2)) : 'unknown',
          usdValue: parseFloat(h.usdValue.toFixed(2)),
          portfolioPercent: totalUsdValue > 0
            ? parseFloat(((h.usdValue / totalUsdValue) * 100).toFixed(1))
            : 0,
        })),
      });
    },
  });
}
