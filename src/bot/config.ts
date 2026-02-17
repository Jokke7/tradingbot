import { z } from 'zod';

/**
 * Bot configuration schema.
 * Parsed from environment variables at startup.
 */
export const BotConfigSchema = z.object({
  /** Trading mode: paper (simulated), testnet (Binance sandbox), live (real money) */
  tradingMode: z.enum(['paper', 'testnet', 'live']).default('paper'),

  /** LLM model for trading decisions (OpenRouter prefix for Qwen3) */
  model: z.string().default('openrouter:qwen/qwen3-235b-a22b'),

  /** Interval between autonomous market checks (ms). Default 5 minutes. */
  checkIntervalMs: z.coerce.number().default(5 * 60 * 1000),

  /** Maximum USD value per trade. Hard limit enforced at client level. */
  maxTradeUsd: z.coerce.number().default(20),

  /** Stop-loss percentage. Triggers position exit. */
  stopLossPercent: z.coerce.number().default(5),

  /** Trading pairs to monitor. Binance symbol format (e.g., BTCUSDT). */
  pairs: z
    .string()
    .default('BTCUSDT,ETHUSDT')
    .transform((s) => s.split(',').map((p) => p.trim().toUpperCase())),

  /** HTTP API port for monitoring/dashboard. */
  apiPort: z.coerce.number().default(3847),

  /** API key for authenticating dashboard requests. */
  apiKey: z.string().optional(),

  /** Daily loss limit in USD. Halts trading if exceeded. */
  dailyLossLimitUsd: z.coerce.number().default(10),

  /** Confidence threshold (0-100) for autonomous trade execution. */
  confidenceThreshold: z.coerce.number().default(70),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;

/**
 * Binance API configuration — separate from bot config for clarity.
 */
export const BinanceConfigSchema = z.object({
  apiKey: z.string().min(1, 'BINANCE_API_KEY is required'),
  apiSecret: z.string().min(1, 'BINANCE_API_SECRET is required'),
  testnet: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

export type BinanceConfig = z.infer<typeof BinanceConfigSchema>;

/**
 * Load bot config from environment variables.
 */
export function loadBotConfig(): BotConfig {
  return BotConfigSchema.parse({
    tradingMode: process.env.TRADING_MODE,
    model: process.env.BOT_MODEL,
    checkIntervalMs: process.env.BOT_CHECK_INTERVAL_MS,
    maxTradeUsd: process.env.BOT_MAX_TRADE_USD,
    stopLossPercent: process.env.BOT_STOP_LOSS_PERCENT,
    pairs: process.env.BOT_PAIRS,
    apiPort: process.env.BOT_API_PORT,
    apiKey: process.env.BOT_API_KEY,
    dailyLossLimitUsd: process.env.BOT_DAILY_LOSS_LIMIT_USD,
    confidenceThreshold: process.env.BOT_CONFIDENCE_THRESHOLD,
  });
}

/**
 * Load Binance config from environment variables.
 * Returns null if keys are not set (allows paper-only mode without Binance).
 */
export function loadBinanceConfig(): BinanceConfig | null {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  // Allow bot to run in paper mode without Binance keys
  if (!apiKey || !apiSecret || apiKey === 'your_key_here') {
    return null;
  }

  return BinanceConfigSchema.parse({
    apiKey,
    apiSecret,
    testnet: process.env.BINANCE_TESTNET,
  });
}
