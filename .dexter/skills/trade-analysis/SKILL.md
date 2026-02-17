---
name: trade-analysis
description: Performs a comprehensive technical and fundamental analysis of a cryptocurrency trading pair. Triggers when user asks for a full analysis, trade recommendation, buy/sell signal, "should I buy", technical analysis, or "analyze [SYMBOL]".
---

# Trade Analysis Skill

## Workflow Checklist

Copy and track progress:
```
Trade Analysis Progress:
- [ ] Step 1: Get current price and 24h statistics
- [ ] Step 2: Calculate RSI (14-period)
- [ ] Step 3: Calculate Moving Averages (SMA 20, 50, 200)
- [ ] Step 4: Calculate Momentum
- [ ] Step 5: Check recent news (optional but recommended)
- [ ] Step 6: Synthesize findings and make recommendation
```

## Step 1: Get Current Price and 24h Statistics

Call the `get_binance_price` tool:

- **Input:** Trading pair symbol (e.g., "BTCUSDT", "ETHUSDT")

**Extract:**
- Current price
- 24h price change (%)
- 24h high and low
- 24h volume

## Step 2: Calculate RSI (Relative Strength Index)

Call the `calculate_rsi` tool:

- **Input:** Trading pair symbol, period=14, interval="1h"

**Extract:**
- RSI value
- Signal: oversold (<30), neutral (30-70), overbought (>70)

## Step 3: Calculate Moving Averages

Call the `calculate_moving_averages` tool:

- **Input:** Trading pair symbol, intervals=["1h", "4h", "1d"]

**Extract:**
- SMA 20, 50, 200 for each timeframe
- Golden cross / death cross signals

## Step 4: Calculate Momentum

Call the `calculate_momentum` tool:

- **Input:** Trading pair symbol, interval="1h"

**Extract:**
- MACD value and signal
- Signal direction (bullish/bearish/neutral)

## Step 5: Check Recent News (Optional)

Call the `web_search` tool to search for recent news about the symbol:

- **Query:** "[SYMBOL] crypto news today" (e.g., "BTC crypto news today")

**Look for:**
- Regulatory news
- Major announcements
- Market sentiment

## Step 6: Synthesize and Recommend

Based on all gathered data, provide:

### 1. Summary Table

| Indicator | Value | Signal |
|-----------|-------|--------|
| Price | $X | - |
| RSI(14) | X | oversold/neutral/overbought |
| SMA 20 | $X | above/below price |
| SMA 50 | $X | above/below price |
| SMA 200 | $X | above/below price |
| MACD | X | bullish/bearish |
| 24h Change | X% | - |

### 2. Technical Score

Calculate a simple score:
- +1 point for each bullish signal (price above MAs, RSI <30, MACD bullish)
- -1 point for each bearish signal (price below MAs, RSI >70, MACD bearish)

**Interpretation:**
- Score +2 or higher: Strong BUY signal
- Score +1: Mild BUY signal (consider)
- Score 0: NEUTRAL - no clear direction
- Score -1: Mild SELL signal (consider)
- Score -2 or lower: Strong SELL signal

### 3. Risk Assessment

- Current volatility (24h range)
- Support and resistance levels
- Position sizing recommendation

### 4. Final Recommendation

Present a clear recommendation with:
- **Action:** BUY / SELL / HOLD
- **Confidence:** High / Medium / Low
- **Reasoning:** Brief summary of key factors
- **Suggested size:** Based on risk parameters (never exceed configured max trade)

### 5. Caveats

Add standard disclaimers:
- This is not financial advice
- Past performance does not guarantee future results
- Always do your own research
- Only invest what you can afford to lose
