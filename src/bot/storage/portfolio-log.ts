import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface PortfolioRecommendationLog {
  timestamp: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  amountUsd: number;
  reasoning: string;
  executed: boolean;
  reason?: string;
}

const LOG_DIR = './logs';
const LOG_FILE = `${LOG_DIR}/portfolio-recommendations.jsonl`;

function ensureDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function logPortfolioRecommendation(log: PortfolioRecommendationLog): void {
  ensureDir();
  const line = JSON.stringify(log) + '\n';
  appendFileSync(LOG_FILE, line);
}

export function logExecutedRecommendation(
  symbol: string,
  action: 'BUY' | 'SELL',
  amountUsd: number,
  reasoning: string
): void {
  logPortfolioRecommendation({
    timestamp: new Date().toISOString(),
    symbol,
    action,
    amountUsd,
    reasoning,
    executed: true,
  });
}

export function logRejectedRecommendation(
  symbol: string,
  action: 'BUY' | 'SELL',
  amountUsd: number,
  reasoning: string,
  reason: string
): void {
  logPortfolioRecommendation({
    timestamp: new Date().toISOString(),
    symbol,
    action,
    amountUsd,
    reasoning,
    executed: false,
    reason,
  });
}
