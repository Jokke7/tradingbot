import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { BinanceClient } from './client.js';
import type { AccountInfo, TradeRecord } from './types.js';

/**
 * Create account tools that use the provided Binance client.
 * Requires signed (authenticated) API access.
 */
export function createAccountTools(client: BinanceClient) {
  const getBinanceBalance = new DynamicStructuredTool({
    name: 'get_binance_balance',
    description:
      'Get current Binance account balances. Shows free and locked amounts ' +
      'for each asset. Only returns assets with non-zero balances.',
    schema: z.object({}),
    func: async () => {
      const account = await client.signedGet<AccountInfo>('/v3/account');
      const nonZero = account.balances.filter(
        (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
      );
      return JSON.stringify({
        canTrade: account.canTrade,
        balances: nonZero.map((b) => ({
          asset: b.asset,
          free: b.free,
          locked: b.locked,
          total: (parseFloat(b.free) + parseFloat(b.locked)).toString(),
        })),
      });
    },
  });

  const getBinanceOpenOrders = new DynamicStructuredTool({
    name: 'get_binance_open_orders',
    description:
      'Get all currently open (unfilled) orders on Binance. ' +
      'Optionally filter by a specific trading pair.',
    schema: z.object({
      symbol: z
        .string()
        .optional()
        .describe("Optional: filter by trading pair, e.g. 'BTCUSDT'"),
    }),
    func: async ({ symbol }) => {
      const params: Record<string, string | number> = {};
      if (symbol) params.symbol = symbol.toUpperCase();

      const orders = await client.signedGet<unknown[]>('/v3/openOrders', params);
      return JSON.stringify({ openOrders: orders });
    },
  });

  const getBinanceTradeHistory = new DynamicStructuredTool({
    name: 'get_binance_trade_history',
    description:
      'Get recent trade history (filled orders) for a specific Binance trading pair. ' +
      'Shows price, quantity, commission, and whether you were buyer/seller.',
    schema: z.object({
      symbol: z.string().describe("Binance trading pair symbol, e.g. 'BTCUSDT'"),
      limit: z
        .number()
        .min(1)
        .max(1000)
        .default(20)
        .describe('Number of recent trades to return (1-1000). Default 20.'),
    }),
    func: async ({ symbol, limit }) => {
      const trades = await client.signedGet<TradeRecord[]>('/v3/myTrades', {
        symbol: symbol.toUpperCase(),
        limit,
      });

      return JSON.stringify({
        symbol: symbol.toUpperCase(),
        count: trades.length,
        trades: trades.map((t) => ({
          time: new Date(t.time).toISOString(),
          side: t.isBuyer ? 'BUY' : 'SELL',
          price: t.price,
          quantity: t.qty,
          quoteQty: t.quoteQty,
          commission: `${t.commission} ${t.commissionAsset}`,
        })),
      });
    },
  });

  return [getBinanceBalance, getBinanceOpenOrders, getBinanceTradeHistory];
}
