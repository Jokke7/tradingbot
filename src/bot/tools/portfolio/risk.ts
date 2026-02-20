import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BotConfig } from '../../config.js';

/**
 * Position sizing tool.
 * Calculates safe trade size based on risk parameters and account balance.
 */
export function createPositionSizingTool(config: BotConfig) {
  return new DynamicStructuredTool({
    name: 'calculate_position_size',
    description:
      'Calculate the recommended position size for a trade based on account balance, ' +
      'risk tolerance, and stop-loss distance. Use this before executing any trade to ' +
      'ensure proper risk management.',
    schema: z.object({
      accountBalanceUsd: z
        .number()
        .positive()
        .describe('Total account balance in USD'),
      entryPrice: z.number().positive().describe('Planned entry price'),
      stopLossPrice: z
        .number()
        .positive()
        .describe('Planned stop-loss price'),
      riskPercent: z
        .number()
        .min(0.1)
        .max(10)
        .default(2)
        .describe('Maximum % of account to risk on this trade. Default 2%.'),
    }),
    func: async ({ accountBalanceUsd, entryPrice, stopLossPrice, riskPercent }) => {
      const riskAmountUsd = accountBalanceUsd * (riskPercent / 100);
      const stopLossDistance = Math.abs(entryPrice - stopLossPrice);
      const stopLossPercent = (stopLossDistance / entryPrice) * 100;

      // Position size in quote currency (USDT)
      let positionSizeUsd = (riskAmountUsd / stopLossDistance) * entryPrice;

      // Enforce hard cap from config
      const cappedByConfig = positionSizeUsd > config.maxTradeUsd;
      if (cappedByConfig) {
        positionSizeUsd = config.maxTradeUsd;
      }

      // Max portfolio exposure check (50% single-asset limit)
      const maxExposureUsd = accountBalanceUsd * 0.5;
      const cappedByExposure = positionSizeUsd > maxExposureUsd;
      if (cappedByExposure) {
        positionSizeUsd = maxExposureUsd;
      }

      // Position size in base asset units (after all caps applied)
      const positionSizeUnits = positionSizeUsd / entryPrice;

      return JSON.stringify({
        recommendedPositionUsd: parseFloat(positionSizeUsd.toFixed(2)),
        recommendedPositionUnits: parseFloat(positionSizeUnits.toFixed(8)),
        riskAmountUsd: parseFloat(riskAmountUsd.toFixed(2)),
        riskPercent,
        stopLossPercent: parseFloat(stopLossPercent.toFixed(2)),
        maxTradeUsd: config.maxTradeUsd,
        warnings: [
          ...(cappedByConfig ? [`Position capped at $${config.maxTradeUsd} (config limit)`] : []),
          ...(cappedByExposure ? ['Position capped at 50% portfolio (exposure limit)'] : []),
          ...(stopLossPercent > config.stopLossPercent
            ? [`Stop-loss distance (${stopLossPercent.toFixed(1)}%) exceeds configured limit (${config.stopLossPercent}%)`]
            : []),
        ],
      });
    },
  });
}
