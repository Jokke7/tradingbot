import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BotConfig, BinanceConfig } from '../config.js';

// Dexter's tool registry — import without modification
import { getToolRegistry, type RegisteredTool } from '../../dexter/src/tools/registry.js';

// Our custom trading tools
import { BinanceClient } from './binance/client.js';
import { createMarketDataTools } from './binance/market-data.js';
import { createAccountTools } from './binance/account.js';
import { createTradeTools } from './binance/trade.js';
import { createRsiTool } from './signals/rsi.js';
import { createMovingAverageTool } from './signals/moving-average.js';
import { createMomentumTool } from './signals/momentum.js';
import { createPortfolioSummaryTool } from './portfolio/position.js';
import { createPositionSizingTool } from './portfolio/risk.js';

/**
 * Build the merged tool registry: Dexter's research tools + our trading tools.
 *
 * This is the core integration point. Dexter's Agent.create() hardcodes its own
 * tool registry, so we build our own tool list here and pass it to TradingAgent.
 */
export function getTradingToolRegistry(
  model: string,
  botConfig: BotConfig,
  binanceConfig: BinanceConfig | null
): RegisteredTool[] {
  // Start with all Dexter tools (financial search, web search, browser, etc.)
  const dexterTools = getToolRegistry(model);

  // If no Binance config, return Dexter tools only (paper mode without keys)
  if (!binanceConfig) {
    return [
      ...dexterTools,
      // Position sizing works without Binance (pure math)
      {
        name: 'calculate_position_size',
        tool: createPositionSizingTool(botConfig),
        description: 'Calculate recommended position size based on risk parameters.',
      },
    ];
  }

  // Create Binance client for tools that need API access
  const client = new BinanceClient(binanceConfig);

  // Market data tools (public endpoints — no auth needed)
  const marketDataTools = createMarketDataTools(client);

  // Account tools (signed endpoints — need auth)
  const accountTools = createAccountTools(client);

  // Trade execution tools (signed + safety gates)
  const tradeTools = createTradeTools(client, botConfig);

  // Signal tools (public data + local computation)
  const signalTools = [
    createRsiTool(client),
    createMovingAverageTool(client),
    createMomentumTool(client),
  ];

  // Portfolio tools
  const portfolioTools = [
    createPortfolioSummaryTool(client),
    createPositionSizingTool(botConfig),
  ];

  // Build registered tool entries for our custom tools
  const tradingTools: RegisteredTool[] = [
    // Binance market data
    ...marketDataTools.map((tool) => ({
      name: tool.name,
      tool: tool as StructuredToolInterface,
      description: tool.description,
    })),
    // Binance account
    ...accountTools.map((tool) => ({
      name: tool.name,
      tool: tool as StructuredToolInterface,
      description: tool.description,
    })),
    // Trade execution
    ...tradeTools.map((tool) => ({
      name: tool.name,
      tool: tool as StructuredToolInterface,
      description: tool.description,
    })),
    // Technical signals
    ...signalTools.map((tool) => ({
      name: tool.name,
      tool: tool as StructuredToolInterface,
      description: tool.description,
    })),
    // Portfolio
    ...portfolioTools.map((tool) => ({
      name: tool.name,
      tool: tool as StructuredToolInterface,
      description: tool.description,
    })),
  ];

  return [...dexterTools, ...tradingTools];
}

/**
 * Get just the tool instances for binding to the LLM.
 */
export function getTradingTools(
  model: string,
  botConfig: BotConfig,
  binanceConfig: BinanceConfig | null
): StructuredToolInterface[] {
  return getTradingToolRegistry(model, botConfig, binanceConfig).map((t) => t.tool);
}

/**
 * Build the tool descriptions section for the system prompt.
 */
export function buildTradingToolDescriptions(
  model: string,
  botConfig: BotConfig,
  binanceConfig: BinanceConfig | null
): string {
  return getTradingToolRegistry(model, botConfig, binanceConfig)
    .map((t) => `### ${t.name}\n\n${t.description}`)
    .join('\n\n');
}
