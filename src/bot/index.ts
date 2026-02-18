#!/usr/bin/env bun
/**
 * Trading Bot — Entry Point
 *
 * Modes:
 *   --interactive  (default)  Boot the Dexter CLI with trading tools added.
 *   --autonomous              Start the autonomous trading loop (Phase 2).
 *   --check                   Verify config and connectivity, then exit.
 *
 * Usage:
 *   bun run src/bot/index.ts                  # interactive mode
 *   bun run src/bot/index.ts --autonomous     # autonomous mode
 *   bun run src/bot/index.ts --check          # connectivity check
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { loadBotConfig, loadBinanceConfig } from './config.js';
import { BinanceClient } from './tools/binance/client.js';

// Load .env from the Dexter directory (where API keys live)
const dexterDir = resolve(import.meta.dir, '../dexter');
loadEnv({ path: resolve(dexterDir, '.env'), quiet: true });

// Also load from project root if exists (for bot-specific vars)
loadEnv({ path: resolve(import.meta.dir, '../../.env'), quiet: true });

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--autonomous')
    ? 'autonomous'
    : args.includes('--check')
      ? 'check'
      : 'interactive';

  // Load and validate config
  const botConfig = loadBotConfig();
  const binanceConfig = loadBinanceConfig();

  console.log('--- Trading Bot ---');
  console.log(`Mode:          ${mode}`);
  console.log(`Trading mode:  ${botConfig.tradingMode}`);
  console.log(`Model:         ${botConfig.model}`);
  console.log(`Pairs:         ${botConfig.pairs.join(', ')}`);
  console.log(`Max trade:     $${botConfig.maxTradeUsd}`);
  console.log(`Binance keys:  ${binanceConfig ? 'configured' : 'NOT configured (paper-only)'}`);
  console.log('');

  if (mode === 'check') {
    await runConnectivityCheck(binanceConfig);
    return;
  }

  if (mode === 'autonomous') {
    await runAutonomousMode(botConfig, binanceConfig);
    return;
  }

  // Interactive mode: boot Dexter CLI with trading tools
  // We dynamically import the Ink/React CLI to avoid loading the full UI
  // framework when running in autonomous/check mode.
  await bootInteractiveMode(botConfig, binanceConfig);
}

/**
 * Test connectivity to Binance API and LLM provider.
 */
async function runConnectivityCheck(binanceConfig: ReturnType<typeof loadBinanceConfig>) {
  console.log('Running connectivity checks...\n');

  // Check Binance
  if (binanceConfig) {
    const client = new BinanceClient(binanceConfig);
    try {
      const reachable = await client.ping();
      const serverTime = reachable ? await client.getServerTime() : 0;
      const localTime = Date.now();
      const drift = Math.abs(serverTime - localTime);

      console.log(`Binance API:   ${reachable ? 'OK' : 'FAILED'}`);
      if (reachable) {
        console.log(`  Server time: ${new Date(serverTime).toISOString()}`);
        console.log(`  Clock drift: ${drift}ms ${drift > 1000 ? '(WARNING: >1s drift may cause signing errors)' : ''}`);
      }
    } catch (e) {
      console.log(`Binance API:   FAILED — ${e instanceof Error ? e.message : e}`);
    }
  } else {
    console.log('Binance API:   SKIPPED (no keys configured)');
  }

  // Check OpenRouter (or whatever LLM provider is configured)
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey && openrouterKey !== 'your-api-key') {
    console.log('OpenRouter:    key present');
  } else {
    console.log('OpenRouter:    NOT configured');
  }

  // Check other Dexter API keys
  const checks = [
    ['Exa Search', 'EXASEARCH_API_KEY'],
    ['Fin. Datasets', 'FINANCIAL_DATASETS_API_KEY'],
  ] as const;

  for (const [name, envVar] of checks) {
    const val = process.env[envVar];
    console.log(`${(name + ':').padEnd(15)} ${val && val !== 'your-api-key' ? 'key present' : 'NOT configured'}`);
  }

  console.log('\nConnectivity check complete.');
}

/**
 * Run the autonomous trading loop.
 */
async function runAutonomousMode(
  botConfig: ReturnType<typeof loadBotConfig>,
  binanceConfig: ReturnType<typeof loadBinanceConfig>
) {
  if (!binanceConfig) {
    console.error('Binance API keys required for autonomous mode.');
    process.exit(1);
  }

  const { createScheduler } = await import('./loop/scheduler.js');
  const { BinanceClient } = await import('./tools/binance/client.js');

  console.log('Starting autonomous trading...\n');

  const client = new BinanceClient(binanceConfig);

  const reachable = await client.ping();
  if (!reachable) {
    console.error('Failed to connect to Binance API.');
    process.exit(1);
  }
  console.log('Binance API: Connected');

  const scheduler = createScheduler(botConfig, binanceConfig, botConfig.model);

  scheduler.on('decision', (pair, decision) => {
    console.log(`[${pair}] ${decision.action} (${decision.confidence}%) - ${decision.reasoning}`);
  });

  scheduler.on('trade', (pair, result) => {
    if (result.executed) {
      console.log(`[${pair}] Trade executed: Order #${result.orderId}`);
    } else {
      console.log(`[${pair}] Trade failed: ${result.error}`);
    }
  });

  scheduler.on('error', (pair, error) => {
    console.error(`[${pair}] Error:`, error.message);
  });

  scheduler.start();

  // Start API server
  const { startApiServer, setScheduler, setState, setBinanceClient } = await import('./api/server.js');
  const { loadState } = await import('./storage/state.js');

  setScheduler(scheduler);
  setBinanceClient(client);

  const state = loadState();
  setState(state);

  const apiPort = botConfig.apiPort;
  const apiKey = botConfig.apiKey;
  const tlsCert = process.env.TLS_CERT_FILE;
  const tlsKey = process.env.TLS_KEY_FILE;
  
  await startApiServer({
    port: apiPort,
    apiKey: apiKey || 'dev-only-key',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    tls: tlsCert && tlsKey ? { certFile: tlsCert, keyFile: tlsKey } : undefined,
  });

  const protocol = tlsCert && tlsKey ? 'https' : 'http';
  console.log(`\nAutonomous mode running. Monitoring: ${botConfig.pairs.join(', ')}`);
  console.log(`API server: ${protocol}://localhost:${apiPort}`);
  console.log('Press Ctrl+C to stop.\n');

  const shutdown = () => {
    console.log('\nShutting down...');
    scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Boot the interactive CLI with trading tools.
 *
 * Strategy: We need Dexter's Ink-based CLI but with our TradingAgent instead
 * of Dexter's Agent. For Phase 0, we use a simple readline-based REPL that
 * sends queries to TradingAgent. The full Ink CLI integration (with real-time
 * tool progress UI) comes in Phase 1.
 */
async function bootInteractiveMode(
  botConfig: ReturnType<typeof loadBotConfig>,
  binanceConfig: ReturnType<typeof loadBinanceConfig>
) {
  const { TradingAgent } = await import('./agent/trading-agent.js');
  const { InMemoryChatHistory } = await import(
    '../dexter/src/utils/in-memory-chat-history.js'
  );

  const chatHistory = new InMemoryChatHistory(botConfig.model);

  console.log('Interactive mode ready. Type your queries below.');
  console.log('Type "exit" or Ctrl+C to quit.\n');

  // Simple readline REPL — Phase 1 will upgrade to full Ink CLI
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('> ', async (query) => {
      const trimmed = query.trim();
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        process.exit(0);
      }

      try {
        const agent = TradingAgent.create(
          { model: botConfig.model, maxIterations: 10 },
          botConfig,
          binanceConfig
        );

        let lastEventType = '';

        for await (const event of agent.run(trimmed, chatHistory)) {
          switch (event.type) {
            case 'thinking':
              console.log(`\n[thinking] ${event.message}\n`);
              break;
            case 'tool_start':
              process.stdout.write(`[${event.tool}] `);
              lastEventType = 'tool_start';
              break;
            case 'tool_progress':
              if (lastEventType === 'tool_start') {
                process.stdout.write(`${event.message}`);
              }
              break;
            case 'tool_end':
              console.log(` (${event.duration}ms)`);
              lastEventType = '';
              break;
            case 'tool_error':
              console.log(` ERROR: ${event.error}`);
              lastEventType = '';
              break;
            case 'answer_start':
              console.log('');
              break;
            case 'done':
              console.log(event.answer);
              if (event.tokenUsage) {
                console.log(
                  `\n[${event.iterations} iterations, ${event.totalTime}ms, ` +
                    `${event.tokenUsage.totalTokens} tokens]`
                );
              }
              console.log('');
              break;
          }
        }
      } catch (e) {
        console.error(`\nError: ${e instanceof Error ? e.message : e}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
