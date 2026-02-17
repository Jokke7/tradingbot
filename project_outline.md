

## Project Overview
This project aims to build a fun, experimental autonomous trading bot focused on cryptocurrency (initially via Binance API) with small stakes (~200 NOK or $20) for learning and software demonstration purposes. The bot extends the open-source Dexter AI agent, which handles financial research, data analysis, and decision-making. It will run on a home Linux hobby server (Manjaro Arch-based) for 24/7 operation, using AI-assisted coding (e.g., OpenCode, Kimi K2.5, Codex, Claude Code) for development.

The bot will:
- Fetch real-time market data (e.g., via Financial Datasets or CoinGecko APIs).
- Use an LLM (Qwen3 via OpenRouter) for reasoning and trading signals (e.g., buy/sell based on simple strategies like RSI thresholds).
- Execute trades autonomously on Binance (starting with testnet/paper trading).
- Log activities and expose secure APIs for monitoring.

A separate dashboard project will visualize bot performance, hosted on Cloudflare Pages at trading.godot.no. This is for personal use only—no production-scale trading or financial advice.

## Goals
- Create an impressive software demo: Autonomous agentic loops for trading decisions.
- Learn fintech basics: Integrate APIs, handle real-time data, implement risk controls (e.g., stop-losses).
- Minimize risks: Use simulated modes first; real trades limited to tiny amounts.
- Scalability: Easy to extend to stocks (e.g., via IBKR API) or other exchanges.

## Key Features
- **Research and Analysis**: Leverage Dexter's core for querying market trends, news (via Exa), and fundamentals.
- **Trading Logic**: Custom extensions for strategies (e.g., momentum, mean-reversion) with self-reflection to avoid bad decisions.
- **Automation**: Persistent loops for monitoring (e.g., check prices every 5 minutes).
- **Safety Mechanisms**: Hard limits on trade sizes, emergency shutdowns, and logging for audits.
- **Integration**: Binance API for crypto; potential future stock APIs (e.g., IBKR, DEGIRO).
- **Data Storage**: Local logs on server; dashboard pulls via API.

## Tech Stack
- **Core Framework**: Dexter (TypeScript/Bun) extended with custom modules.
- **LLM**: Qwen3 Next 80B A3B Instruct via OpenRouter.
- **APIs**: Binance (for trading), Financial Datasets/CoinGecko (data), Exa (web search).
- **Development Tools**: AI coders (Kimi K2.5, Codex, Claude) via OpenCode TUI.
- **Hosting**: Home Manjaro server for bot; GitHub for source control.
- **Dashboard (Separate)**: To be determined (e.g., React/Next.js); hosted on Cloudflare Pages with KV for storage.

## Development Plan
1. **Setup Core**: Install Dexter in project subfolder; test basic research queries.
2. **Extend for Trading**: Add Binance integration; implement simple strategies.
3. **Testing**: Use Binance testnet; simulate trades with historical data.
4. **API Exposure**: Secure endpoints for dashboard polling (e.g., via Express.js).
5. **Deployment**: Run bot with pm2 for process management; auto-updates via GitHub webhooks.
6. **Dashboard Integration**: Poll bot API; store metrics in Cloudflare KV.

## Risks and Mitigations
- Financial loss: Limit to $20; start with simulations.
- Downtime: Use UPS for server; monitor with alerts.
- Security: API keys in .env; firewall restrictions.
- Legal: Personal hobby in Norway; track trades for taxes if profitable.

## Repository Structure
- `src/dexter/`: Cloned Dexter core.
- `extensions/`: Custom trading logic and API wrappers.
- `tools/`: Utility scripts (e.g., backtesters).
- `logs/`: Trade and error logs.
- `index.ts`: Main entry point for bot loops.


---

### Detailed Overview of Architectural Choices

This architecture is designed for a hobbyist setup: low-cost, modular, and focused on learning while minimizing risks. It's split into two main projects (bot and dashboard) for separation of concerns—bot handles execution (persistent, backend-heavy), dashboard focuses on visualization (frontend, serverless). Choices prioritize your constraints: Home server for bot, Windows PC for dashboard dev, GitHub for SC, Cloudflare for hosting, and AI-assisted coding.

#### 1. **Overall System Architecture**
- **Monolithic Bot with Modular Extensions**: The bot is a single TypeScript app extending Dexter, running as a persistent process. This keeps it simple for a solo dev but modular (e.g., separate folders for extensions) to avoid spaghetti code. Why? Dexter's agentic loop (plan → execute → reflect) is ideal for trading decisions, and extending it reuses battle-tested code rather than building from scratch.
- **Client-Server Split**: Bot as backend server (on home Linux); dashboard as frontend client (hosted on Cloudflare). Communication via REST APIs or WebSockets for real-time updates. Why separate? Reduces coupling—bot can run independently if dashboard is down. Also matches your plan: Develop dashboard on Windows PC without SSH hassles.
- **Event-Driven Loops**: Bot uses timed intervals (e.g., Node.js `setInterval`) for market checks and trades. Why? Suits autonomous trading without needing complex schedulers; easy to implement with AI tools.
- **Data Flow**: Bot pulls data from APIs → Processes with LLM → Executes trades → Logs locally and exposes via API. Dashboard polls API (e.g., every 30s) or subscribes to WebSockets → Stores aggregates in Cloudflare KV → Renders charts/UI.

#### 2. **Bot Architecture (Home Manjaro Server)**
- **Runtime**: Bun for speed (faster than Node.js for I/O-heavy tasks like API calls). Why? Dexter is Bun-native; aligns with your Arch setup (easy install via curl).
- **Core**: Dexter's Researcher agent extended for trading. Custom tools in `extensions/` (e.g., `binanceTradeTool.ts`) for buy/sell actions. Why? Leverages Dexter's self-reflection to add "safety checks" (e.g., "Is this trade risky? Abort if volatility high").
- **Persistence and Reliability**: Use pm2 (Bun-compatible process manager) for auto-restarts on crashes. Docker optional for isolation. Local file logging (JSON/CSV in `logs/`) for audits. Why? Home servers can be unstable—pm2 ensures uptime; logs help debug without cloud costs.
- **Security**: .env for secrets; UFW firewall to restrict ports (e.g., open only for SSH and API if needed). API endpoints protected by JWT or API keys. Why critical? Home exposure risks hacks; Norway's GDPR adds data protection needs for any personal trade logs.
- **Scalability Limits**: Single-threaded for now; if growing, add Redis for state if multi-strategy. Why? Hobby-scale—over-engineering unnecessary for $20 stakes.
- **Development Workflow**: SSH from Windows Git Bash for coding; AI tools in TUI (OpenCode renders well). Git push to GitHub for versioning; webhooks for auto-pulls/updates. Why? Fits your preference—terminal-based, no GUI needed on server.

#### 3. **Dashboard Architecture (Separate Project on Windows PC)**
- **Tech Stack Recommendation**: React with Next.js for the framework (static generation + API routes). Why? Next.js deploys easily to Cloudflare Pages (via adapters); handles polling/WebSockets out-of-box. Alternatives: SvelteKit if you want lighter, or Vue if familiar. Avoid heavy like Angular for a simple dashboard.
- **Data Handling**: Poll bot's API (e.g., GET /status for trades/metrics) or use WebSockets (via Socket.io) for pushes. Store persistent data in Cloudflare KV (key-value store, free tier: 100K reads/writes/day). Why KV? Serverless, fast, integrated with Pages—perfect for small metrics (e.g., trade history as JSON). Alternatives: D1 (Cloudflare's SQL) if queries grow complex, or Workers KV for edge caching.
- **UI Components**: Charts via Chart.js or Recharts; real-time updates with React hooks. Authentication: Simple API key or OAuth if public-facing. Why? Keeps it impressive—visualize PNL, trade logs, signals—without overcomplicating.
- **Hosting**: Cloudflare Pages for static hosting with dynamic functions (via Workers). Custom domain trading.godot.no with free SSL. Why? Low latency in Norway, auto-deploys from GitHub, built-in security (WAF, DDoS). Critically: Pages excels at JAMstack—your dashboard fits (static UI + serverless API calls).
- **Development Workflow**: Code on Windows PC (VS Code or similar); Git to separate GitHub repo (e.g., trading-dashboard). Local testing: Run Next.js dev server, mock bot API with tools like json-server. Deploy: Git push triggers Cloudflare builds.
- **Integration with Bot**: Bot exposes /api endpoints (e.g., via Express in Dexter extensions). Use Cloudflare Tunnel to securely proxy from home server to dashboard without public IPs. Why? Avoids direct exposure; Tunnel is free and zero-config.

#### 4. **Pros, Cons, and Trade-Offs**
- **Pros**: Cost-effective (mostly free tiers); modular for easy AI-assisted extensions; fits your setup (SSH dev, Windows for UI). Separation ensures bot reliability isn't tied to dashboard deploys.
- **Cons/Criticisms**: Home server downtime risk—mitigate with alerts (e.g., via Telegram bot). Polling adds latency vs. WebSockets (use latter for real-time). KV limits scale if logs explode—start small. Overall: Great for hobby, but if it "impresses" and grows, migrate bot to VPS (e.g., Hetzner) for better uptime.
- **Why These Choices?** Balances fun/impressiveness with feasibility—leverages free tools (GitHub, Cloudflare) while using your hardware. AI coding fits modular extensions; small stakes justify simplicity over enterprise-grade (e.g., no Kubernetes).
