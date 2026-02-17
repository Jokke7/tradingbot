# Trading Bot — Development Plan

> Autonomous crypto trading bot extending Dexter, for hobby/learning use.
> Target: Manjaro home server, ~$20 stakes, Binance testnet first.
> This plan serves both human developers and LLM-assisted coding agents.

---

## Table of Contents

1. [Architecture Decisions](#architecture-decisions)
2. [Repository Structure](#repository-structure)
3. [Phase 0 — Foundation & Setup](#phase-0--foundation--setup)
4. [Phase 1 — Interactive Trading Tools](#phase-1--interactive-trading-tools)
5. [Phase 2 — Autonomous Loop](#phase-2--autonomous-loop)
6. [Phase 3 — Monitoring API & Persistence](#phase-3--monitoring-api--persistence)
7. [Phase 4 — Safety, Testing & Hardening](#phase-4--safety-testing--hardening)
8. [Phase 5 — Production Deployment](#phase-5--production-deployment)
9. [Phase 6 — Dashboard (Separate Project)](#phase-6--dashboard-separate-project)
10. [Environment Variables](#environment-variables)
11. [Risk Register](#risk-register)
12. [LLM Agent Instructions](#llm-agent-instructions)

---

## Architecture Decisions

### AD-1: Wrapper pattern — Do NOT modify Dexter core

Dexter (`src/dexter/`) is treated as an **upstream dependency**. All custom
trading logic lives outside it. We import Dexter's exports (Agent class, LLM
utilities, tool types, scratchpad) but never edit files inside `src/dexter/`.

**Rationale**: Dexter is actively maintained. Keeping it untouched lets us
`git pull` upstream updates without merge conflicts. If Dexter doesn't export
something we need, we wrap or re-export it — we don't patch.

**Consequence**: We need our own entry point (`src/bot/index.ts`), our own
tool registry that merges Dexter's tools with ours, and our own agent class.

**Implementation note (discovered during Phase 0)**: Dexter's `Agent.create()`
uses a private constructor and hardcodes `getTools(model)` internally — there is
no way to inject custom tools from outside. Rather than patching Dexter, we built
`TradingAgent` (`src/bot/agent/trading-agent.ts`) which replicates Dexter's
agent loop using Dexter's own exported building blocks (`callLlm`, `Scratchpad`,
`AgentToolExecutor`, `createRunContext`, etc.) but with our merged tool registry
and trading-specific system prompt. This keeps Dexter untouched while giving us
full control over tools and prompts.

### AD-2: Interactive-first development

Phase 1 validates all trading logic through Dexter's interactive CLI. You ask
the bot "Should I buy BTC?" and it uses trading tools to reason, analyze, and
optionally execute. Only after this works reliably do we build the autonomous
loop (Phase 2).

**Rationale**: Debugging autonomous loops is hard. Interactive mode gives
immediate feedback and lets us validate the LLM's trading reasoning before
trusting it with automated execution.

### AD-3: Embedded monitoring API

The HTTP API for dashboard polling runs inside the bot process using Bun's
built-in `Bun.serve()`. No Express dependency needed.

**Rationale**: Single process = simpler deployment, direct access to in-memory
bot state (positions, recent trades, signals). Bun's HTTP server is
production-capable for the expected load (~1 req/sec from dashboard).

### AD-4: LLM choice — Qwen3 via OpenRouter

The trading bot uses `openrouter:qwen/qwen3-235b-a22b` (or latest Qwen3
variant) via OpenRouter. This is configured at the wrapper level, not by
modifying Dexter's defaults.

**Rationale**: Cost-effective for 24/7 autonomous operation. OpenRouter gives
model flexibility without vendor lock-in. Dexter's `llm.ts` already supports
OpenRouter via the `openrouter:` prefix.

### AD-5: Paper trading by default

Every trading function has a `dryRun` mode that is ON by default. Real
execution requires an explicit environment variable `TRADING_MODE=live`.

**Rationale**: Prevents accidental real trades during development. Defense in
depth — even if logic bugs exist, money stays safe.

---

## Repository Structure

```
tradingbot/
├── PLAN.md                          # This file
├── project_outline.md               # Original project brief
├── src/
│   ├── dexter/                      # Upstream Dexter (DO NOT MODIFY)
│   └── bot/                         # Our custom code
│       ├── index.ts                 # Entry point: CLI mode or autonomous mode
│       ├── config.ts                # Bot configuration (Zod schema)
│       ├── agent/
│       │   ├── trading-agent.ts     # Wraps Dexter Agent with trading tools
│       │   ├── trading-prompts.ts   # System prompt extensions for trading
│       │   └── index.ts
│       ├── tools/
│       │   ├── registry.ts          # Merges Dexter tools + trading tools
│       │   ├── binance/
│       │   │   ├── client.ts        # Binance API client (REST + WebSocket)
│       │   │   ├── account.ts       # Balance, positions, order history
│       │   │   ├── market-data.ts   # Real-time prices, orderbook, klines
│       │   │   ├── trade.ts         # Place/cancel orders (with dryRun gate)
│       │   │   ├── types.ts         # Binance-specific types
│       │   │   └── index.ts
│       │   ├── signals/
│       │   │   ├── rsi.ts           # RSI calculation + signal generation
│       │   │   ├── moving-average.ts # SMA/EMA crossovers
│       │   │   ├── momentum.ts      # Price momentum indicators
│       │   │   └── index.ts
│       │   ├── portfolio/
│       │   │   ├── position.ts      # Current positions + P&L
│       │   │   ├── risk.ts          # Position sizing, stop-loss calc
│       │   │   └── index.ts
│       │   └── index.ts
│       ├── strategies/
│       │   ├── types.ts             # Strategy interface definition
│       │   ├── rsi-threshold.ts     # Buy <30, sell >70 (starter strategy)
│       │   ├── mean-reversion.ts    # Future: Bollinger Bands strategy
│       │   └── index.ts
│       ├── loop/
│       │   ├── scheduler.ts         # Interval-based autonomous loop
│       │   ├── decision-engine.ts   # Orchestrates: data → signal → reason → trade
│       │   └── index.ts
│       ├── api/
│       │   ├── server.ts            # Bun.serve() HTTP API
│       │   ├── routes.ts            # GET /status, /trades, /portfolio, /health
│       │   ├── auth.ts              # API key middleware
│       │   └── index.ts
│       ├── storage/
│       │   ├── trade-log.ts         # Append-only JSON trade log
│       │   ├── state.ts             # Bot state persistence (positions, config)
│       │   └── index.ts
│       └── utils/
│           ├── indicators.ts        # Technical indicator calculations
│           ├── formatters.ts        # Price/volume formatting helpers
│           └── index.ts
├── extensions/                      # Future: additional exchange adapters
├── tools/                           # Utility scripts
│   └── backtest.ts                  # Historical data backtester (Phase 4)
├── logs/                            # Runtime trade + error logs (gitignored)
├── skills/                          # Trading-specific SKILL.md workflows
│   └── trade-analysis/
│       └── SKILL.md                 # Multi-step trade analysis workflow
└── tests/
    ├── tools/
    │   ├── binance-client.test.ts
    │   └── signals.test.ts
    ├── strategies/
    │   └── rsi-threshold.test.ts
    ├── loop/
    │   └── decision-engine.test.ts
    └── api/
        └── routes.test.ts
```

---

## Phase 0 — Foundation & Setup

**Goal**: Working dev environment, Binance testnet access, bot entry point that
boots Dexter with custom config.

### Tasks

#### 0.1 Binance Account & Testnet Setup
- Create a Binance account at https://www.binance.com (if not done)
- Generate testnet API keys at https://testnet.binance.vision/
- Document: testnet base URL is `https://testnet.binance.vision/api`
- Store keys in `.env` as `BINANCE_API_KEY` and `BINANCE_API_SECRET`
- Add `BINANCE_TESTNET=true` flag (switches base URL)

#### 0.2 Project Scaffolding
- Create `src/bot/` directory structure per the tree above
- Create `src/bot/config.ts` with Zod schema:
  ```typescript
  export const BotConfigSchema = z.object({
    tradingMode: z.enum(['paper', 'testnet', 'live']).default('paper'),
    model: z.string().default('openrouter:qwen/qwen3-235b-a22b'),
    checkIntervalMs: z.number().default(5 * 60 * 1000), // 5 min
    maxTradeUsd: z.number().default(20),
    stopLossPercent: z.number().default(5),
    pairs: z.array(z.string()).default(['BTCUSDT', 'ETHUSDT']),
    apiPort: z.number().default(3847),
  });
  ```
- Create `src/bot/index.ts` entry point that:
  - Loads `.env` from the Dexter directory (reuse their dotenv setup)
  - Parses bot config from env
  - In `--interactive` mode: boots Dexter CLI with extended tools
  - In `--autonomous` mode: starts the trading loop (Phase 2)

#### 0.3 Wrapper Tool Registry
- Create `src/bot/tools/registry.ts` that:
  - Calls Dexter's `getToolRegistry(model)` to get base tools
  - Appends our custom trading tools (Binance, signals, portfolio)
  - Returns merged `RegisteredTool[]`
- This is the critical integration point — our tools become available to
  Dexter's agent loop without modifying Dexter's source.

#### 0.4 Verify Dexter Boots
- Run `bun run src/bot/index.ts --interactive`
- Confirm Dexter CLI starts with all original tools + new trading tools visible
- Test a basic query: "What's the current BTC price?" (should use Dexter's
  existing crypto tools)

### Deliverables
- [ ] `.env` with Binance testnet keys
- [ ] `src/bot/config.ts` — validated config
- [ ] `src/bot/index.ts` — entry point
- [ ] `src/bot/tools/registry.ts` — merged tool registry
- [ ] Bot boots in interactive mode with extended tools

---

## Phase 1 — Interactive Trading Tools

**Goal**: All trading primitives work through Dexter's interactive CLI. A user
can ask "Buy 0.001 BTC" and the agent reasons through it and executes (on
testnet).

### Tasks

#### 1.1 Binance API Client (`src/bot/tools/binance/client.ts`)
- Implement authenticated REST client for Binance:
  - HMAC-SHA256 request signing (Binance requirement)
  - Base URL switching: testnet vs production
  - Rate limit awareness (1200 req/min for orders)
  - Error handling with typed Binance error codes
- Dependencies: None external — use Bun's native `fetch` + `crypto` for HMAC.
  Do NOT add `binance-api-node` or similar; keep deps minimal.

#### 1.2 Market Data Tool (`src/bot/tools/binance/market-data.ts`)
- LangChain `DynamicStructuredTool` exposing:
  - `get_binance_price` — current price for a trading pair
  - `get_binance_klines` — candlestick data (1m, 5m, 1h, 1d intervals)
  - `get_binance_orderbook` — top N bids/asks
- These complement Dexter's existing `getCryptoPriceSnapshot` (which uses
  Financial Datasets API). Binance data is more real-time and includes
  orderbook depth.

#### 1.3 Account Tool (`src/bot/tools/binance/account.ts`)
- `get_binance_balance` — USDT + held crypto balances
- `get_binance_positions` — open orders and fills
- `get_binance_trade_history` — recent trades for a pair

#### 1.4 Trade Execution Tool (`src/bot/tools/binance/trade.ts`)
- `execute_binance_trade` — place market or limit order
  - **Critical safety gate**: If `TRADING_MODE !== 'live'` AND not testnet,
    simulate the trade and return a mock response. Log what *would* have
    happened.
  - If `TRADING_MODE === 'testnet'`, execute on testnet API.
  - If `TRADING_MODE === 'live'`, execute on production API (with hard USD cap).
  - Input schema enforces `maxTradeUsd` from config.
  - Returns: order ID, fill price, quantity, status.
- `cancel_binance_order` — cancel an open order by ID.

#### 1.5 Technical Signals Tools (`src/bot/tools/signals/`)
- `calculate_rsi` — RSI for a pair over N periods (default 14)
- `calculate_moving_averages` — SMA(20), SMA(50), EMA(12), EMA(26)
- `calculate_momentum` — rate of change, MACD
- These are pure computation tools — they fetch klines from the Binance tool,
  compute indicators, and return structured results. The LLM then interprets
  them.

#### 1.6 Portfolio Tool (`src/bot/tools/portfolio/`)
- `get_portfolio_summary` — current holdings, total value, unrealized P&L
- `calculate_position_size` — given risk %, stop-loss, and account balance,
  returns safe position size (Kelly criterion simplified)

#### 1.7 Trading System Prompt (`src/bot/agent/trading-prompts.ts`)
- Extend Dexter's system prompt with trading-specific instructions:
  - "You are a crypto trading assistant. You have access to Binance trading
    tools. ALWAYS check portfolio and risk before executing trades."
  - "For trade requests: 1) Check current price, 2) Analyze RSI and momentum,
    3) Check portfolio exposure, 4) Calculate position size, 5) Self-reflect:
    'Is this trade within risk limits? Am I chasing?', 6) Execute or decline
    with reasoning."
  - "NEVER exceed the configured max trade size. If asked to, explain the
    limit."
  - Include current `tradingMode` in prompt so LLM knows it's paper/testnet.

#### 1.8 Trade Analysis Skill (`skills/trade-analysis/SKILL.md`)
- A SKILL.md workflow the agent can invoke for deep trade analysis:
  1. Fetch current price + 24h change
  2. Calculate RSI(14), SMA(20/50), MACD
  3. Check recent news via web_search
  4. Analyze portfolio exposure
  5. Generate buy/sell/hold recommendation with confidence score
  6. If confidence > 70% and user requested: execute trade

### Deliverables
- [ ] Binance client with HMAC signing and testnet support
- [ ] 4 tool groups registered: market-data, account, trade, signals, portfolio
- [ ] Trading-aware system prompt
- [ ] Testnet trade executed via CLI: "Buy $5 of ETH" -> agent reasons -> order placed
- [ ] Trade analysis skill working end-to-end

---

## Phase 2 — Autonomous Loop

**Goal**: Bot runs unattended, checking markets on interval, making and
executing trade decisions without human input.

### Tasks

#### 2.1 Decision Engine (`src/bot/loop/decision-engine.ts`)
- Core function: `async evaluatePair(pair: string): Promise<TradeDecision>`
  1. Fetch latest klines (1h, 100 candles)
  2. Compute all signals (RSI, MA crossovers, MACD)
  3. Build a structured prompt with signal data + portfolio state
  4. Call LLM (Qwen3 via OpenRouter) with a focused prompt:
     "Given these signals for BTCUSDT, current portfolio, and risk limits,
     should we BUY, SELL, or HOLD? Respond with JSON: {action, confidence,
     reasoning, size_usd}"
  5. Parse LLM response (use Zod structured output)
  6. If action !== HOLD and confidence > threshold: execute via trade tool
  7. Log decision (executed or not) to trade log

- **Self-reflection loop**: After the LLM's initial decision, run a second
  LLM call: "Review your decision: [decision]. Are there risks you missed?
  Confirm or revise." This mirrors Dexter's agent reflection pattern.

#### 2.2 Scheduler (`src/bot/loop/scheduler.ts`)
- Simple `setInterval`-based loop:
  ```
  while (running) {
    for (const pair of config.pairs) {
      await decisionEngine.evaluatePair(pair);
    }
    await sleep(config.checkIntervalMs);
  }
  ```
- Graceful shutdown on SIGINT/SIGTERM
- Error isolation: if one pair evaluation fails, log error and continue
  to next pair (don't crash the loop)
- Circuit breaker: if 3 consecutive errors for a pair, skip it for 30 minutes

#### 2.3 Entry Point Integration
- `src/bot/index.ts` with `--autonomous` flag starts the scheduler
- The monitoring API (Phase 3) starts alongside the loop
- Startup sequence: load config -> validate env -> connect to Binance (verify
  keys) -> start API server -> start trading loop

### Deliverables
- [ ] Decision engine with LLM-powered analysis + self-reflection
- [ ] Interval scheduler with error isolation
- [ ] Bot runs autonomously for 1 hour on testnet without crashing
- [ ] All decisions logged to `logs/`

---

## Phase 3 — Monitoring API & Persistence

**Goal**: HTTP API for dashboard polling, persistent trade logs, bot state
survives restarts.

### Tasks

#### 3.1 Trade Log (`src/bot/storage/trade-log.ts`)
- Append-only JSONL file: `logs/trades.jsonl`
- Each line: `{timestamp, pair, action, price, quantity, usd_value, confidence,
  reasoning, order_id, status, mode}`
- Rotation: new file per day (`trades-2026-02-17.jsonl`)
- Read functions: `getRecentTrades(n)`, `getTradesForPair(pair, since)`

#### 3.2 Bot State (`src/bot/storage/state.ts`)
- JSON file: `logs/state.json`
- Contains: current positions (synced from Binance), last check time per pair,
  cumulative P&L, error counts
- Loaded on startup, saved after each trade decision

#### 3.3 HTTP API (`src/bot/api/server.ts`)
- `Bun.serve()` on configurable port (default 3847)
- Routes:
  - `GET /health` — `{status: "ok", uptime, mode, version}`
  - `GET /status` — current loop state, last check times, active pairs
  - `GET /portfolio` — balances, positions, unrealized P&L
  - `GET /trades?limit=50&pair=BTCUSDT` — recent trade log
  - `GET /signals/:pair` — latest computed signals for a pair
  - `POST /config` — update runtime config (e.g., change pairs, interval)
  - `POST /emergency-stop` — halt all trading immediately
- Auth: API key in `X-API-Key` header, validated against `BOT_API_KEY` env var

#### 3.4 CORS & Security
- CORS headers for dashboard domain (`trading.godot.no`)
- Rate limiting: 60 req/min per IP (in-memory counter, no Redis needed)
- No sensitive data in responses (no API keys, no full order details beyond
  what's in trade log)

### Deliverables
- [ ] Trade log with daily rotation
- [ ] State persistence across restarts
- [ ] HTTP API with all routes
- [ ] API key auth working
- [ ] `curl http://localhost:3847/health` returns valid response

---

## Phase 4 — Safety, Testing & Hardening

**Goal**: Confidence that the bot won't lose money unexpectedly. Comprehensive
test coverage. Backtesting infrastructure.

### Tasks

#### 4.1 Safety Mechanisms
- **Hard trade cap**: Reject any order > `maxTradeUsd` at the client level
  (defense in depth — even if LLM hallucinates a large amount)
- **Daily loss limit**: If cumulative daily loss > $10, halt trading for the day
- **Volatility circuit breaker**: If 5-minute price change > 5%, skip trading
  for that pair for 30 minutes
- **Emergency stop**: `POST /emergency-stop` sets a flag that prevents all
  trade execution until manually cleared
- **Position limits**: Max 50% of portfolio in any single asset

#### 4.2 Unit Tests
- Binance client: mock API responses, test HMAC signing, test error handling
- Signal calculations: known inputs -> expected RSI/SMA/MACD values
- Decision engine: mock LLM responses, verify trade/no-trade decisions
- Safety gates: verify all limits are enforced
- API routes: request/response validation

#### 4.3 Integration Tests
- End-to-end with Binance testnet: place order -> verify fill -> check balance
- Full decision cycle with real LLM call (use cheap model for tests)

#### 4.4 Backtester (`tools/backtest.ts`)
- Load historical klines from Binance API
- Replay through decision engine with mock execution
- Output: total return, max drawdown, win rate, Sharpe ratio
- Helps validate strategies before deploying them live

### Deliverables
- [ ] All safety mechanisms implemented and tested
- [ ] >80% test coverage on critical paths (trading, safety, signals)
- [ ] Backtester producing meaningful results
- [ ] CI pipeline: `bun test` runs all tests

---

## Phase 5 — Production Deployment

**Goal**: Bot running 24/7 on the Manjaro server, monitored and auto-restarting.

### Tasks

#### 5.1 pm2 Setup
- Install pm2: `bun install -g pm2`
- Create `ecosystem.config.cjs`:
  ```javascript
  module.exports = {
    apps: [{
      name: 'tradingbot',
      script: 'bun',
      args: 'run src/bot/index.ts --autonomous',
      cwd: '/path/to/tradingbot',
      env: { NODE_ENV: 'production' },
      max_restarts: 10,
      restart_delay: 5000,
      log_file: 'logs/pm2.log',
      error_file: 'logs/pm2-error.log',
    }]
  };
  ```
- `pm2 start ecosystem.config.cjs`
- `pm2 save` for auto-start on reboot

#### 5.2 Firewall (UFW)
- Allow SSH (port 22)
- Allow bot API port (3847) only from known IPs or via Cloudflare Tunnel
- Deny all other inbound

#### 5.3 Cloudflare Tunnel (for Dashboard)
- Install `cloudflared` on Manjaro server
- Create tunnel: `cloudflared tunnel create tradingbot`
- Route `api.trading.godot.no` -> `localhost:3847`
- This securely exposes the bot API without opening ports publicly

#### 5.4 GitHub Webhooks (Optional)
- Simple webhook endpoint in the bot API: `POST /deploy`
- On push to main: `git pull && pm2 restart tradingbot`
- Secured with webhook secret

#### 5.5 Alerting
- On consecutive errors: send notification (Telegram bot or email)
- On emergency stop trigger: send alert
- On daily P&L summary: send report
- Implementation: simple `fetch()` to Telegram Bot API (no library needed)

### Deliverables
- [ ] Bot running via pm2, auto-restarts on crash
- [ ] Firewall configured
- [ ] Cloudflare Tunnel routing API traffic
- [ ] Alerts working for critical events

---

## Phase 6 — Dashboard (Separate Project)

> This is a high-level outline only. The dashboard is a separate repository
> (`trading-dashboard`) with its own detailed plan.

### Tech Stack
- **Framework**: Next.js 15 (App Router) — deploys to Cloudflare Pages
- **Styling**: Tailwind CSS
- **Charts**: Recharts or Lightweight Charts (TradingView)
- **Data**: Polls bot API every 30s; caches in Cloudflare KV
- **Auth**: Simple API key (personal use)
- **Domain**: `trading.godot.no` via Cloudflare DNS

### Key Pages
- **Dashboard**: Portfolio value chart, current positions, recent signals
- **Trades**: Filterable trade history table with reasoning
- **Signals**: Real-time RSI/MA charts per pair
- **Config**: View/edit bot config, emergency stop button
- **Logs**: Scrollable bot activity feed

### API Contract (Bot <-> Dashboard)

The dashboard consumes these bot API endpoints:

| Endpoint              | Method | Response                          |
|-----------------------|--------|-----------------------------------|
| `/health`             | GET    | `{status, uptime, mode, version}` |
| `/status`             | GET    | `{pairs, lastCheck, loopState}`   |
| `/portfolio`          | GET    | `{balances, positions, pnl}`      |
| `/trades`             | GET    | `[{timestamp, pair, action, ...}]`|
| `/signals/:pair`      | GET    | `{rsi, sma20, sma50, macd, ...}`  |
| `/config`             | POST   | `{updated: true}`                 |
| `/emergency-stop`     | POST   | `{stopped: true}`                 |

### Deployment
- Git push to `trading-dashboard` repo triggers Cloudflare Pages build
- Environment variable: `BOT_API_URL=https://api.trading.godot.no`
- KV namespace for caching trade history (avoid hammering bot API)

---

## Environment Variables

Add these to `src/dexter/.env` (alongside existing Dexter keys):

```bash
# Binance
BINANCE_API_KEY=your_key_here
BINANCE_API_SECRET=your_secret_here
BINANCE_TESTNET=true                # true = use testnet URLs

# Trading Bot
TRADING_MODE=paper                  # paper | testnet | live
BOT_API_KEY=generate_a_random_key   # for dashboard auth
BOT_API_PORT=3847

# LLM for trading (override Dexter default)
BOT_MODEL=openrouter:qwen/qwen3-235b-a22b

# Alerts (optional)
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
```

---

## Risk Register

| Risk                        | Likelihood | Impact | Mitigation                                        |
|-----------------------------|------------|--------|---------------------------------------------------|
| LLM hallucinates trade      | Medium     | Medium | Hard caps, self-reflection, paper mode default     |
| Binance API rate limit      | Low        | Low    | Rate limiter in client, exponential backoff         |
| Server crash mid-trade      | Low        | Medium | pm2 auto-restart, state persistence, order tracking |
| API key leak                | Low        | High   | .env gitignored, firewall, key rotation             |
| Exchange downtime           | Low        | Low    | Graceful error handling, retry with backoff          |
| Strategy loses money        | High       | Low    | $20 cap, backtesting before live, daily loss limit   |
| LLM provider outage         | Medium     | Medium | Fallback model config, circuit breaker on loop       |
| Home server power loss      | Low        | Low    | UPS (if available), pm2 auto-start on boot           |

---

## LLM Agent Instructions

> For AI coding assistants (Kimi K2.5, Codex, MiniMax 2.5, Claude Code, etc.)
> working on this project.

### Rules
1. **NEVER modify files inside `src/dexter/`** — it is upstream. All custom
   code goes in `src/bot/`, `tools/`, `skills/`, or `tests/`.
2. Follow Dexter's coding style: strict TypeScript, ESM, no `any`, brief
   comments for non-obvious logic.
3. Use Zod for all input validation (Dexter pattern).
4. Use `DynamicStructuredTool` from LangChain for new tools (match Dexter's
   tool pattern in `src/dexter/src/tools/finance/crypto.ts`).
5. All trade execution must go through the safety gate in `trade.ts` —
   never call Binance API directly from other modules.
6. Test files live in `tests/` mirroring `src/bot/` structure.
7. Run `bun test` before considering any task complete.
8. Do not add npm dependencies unless absolutely necessary. Prefer Bun
   built-ins (`fetch`, `crypto`, `Bun.serve()`, `Bun.file()`).
9. Log trade decisions to `logs/trades.jsonl` — every decision, even HOLDs.
10. When implementing a phase, check off deliverables in this file.

### Implementation Order
Follow the phases in order. Within a phase, tasks are numbered by dependency
order. Do not skip ahead to Phase N+1 until Phase N deliverables are complete.

### Key Integration Points
- **Tool registration**: `src/bot/tools/registry.ts` merges Dexter + custom tools
- **Agent creation**: `src/bot/agent/trading-agent.ts` creates Dexter's Agent
  with custom tool registry and trading system prompt
- **Entry point**: `src/bot/index.ts` replaces Dexter's `src/index.tsx` as
  the thing you actually run
- **Config**: `src/bot/config.ts` centralizes all bot-specific configuration
