# Trading Bot

An autonomous crypto trading bot extending the Dexter AI agent framework.

## Features

- Autonomous trading on Binance Testnet (paper mode available)
- AI-powered decision making using LLM
- Technical analysis (RSI, SMA, MACD, momentum)
- Safety mechanisms: emergency stop, daily loss limits, circuit breakers
- REST API for monitoring and control
- Dashboard integration

## Setup

```bash
bun install
cp src/dexter/.env.example src/dexter/.env  # Configure your API keys
```

## Running

```bash
# Check connectivity
bun run src/bot/index.ts --check

# Interactive mode
bun run src/bot/index.ts

# Autonomous mode
bun run src/bot/index.ts --autonomous
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BINANCE_API_KEY` | Binance API key |
| `BINANCE_API_SECRET` | Binance API secret |
| `OPENROUTER_API_KEY` | LLM provider key |
| `TRADING_MODE` | paper, testnet, or live |
| `BOT_API_KEY` | API authentication key |

## API

The bot exposes a REST API on port 3847 when running in autonomous mode:

- `GET /health` - Health check
- `GET /status` - Bot status
- `GET /portfolio` - Account balances
- `GET /trades` - Trade history
- `GET /signals/:pair` - Technical indicators
- `POST /emergency-stop` - Stop/resume trading

## Safety

- $20 max trade limit
- $10 daily loss limit
- Emergency stop persisted across restarts

## License

MIT
