# crypto-signal

KuCoin WebSocket market monitor. Watches up to 50 crypto pairs in real time and fires alerts when a symbol moves ±2%, ±4%, ±10%, or ±20% from its baseline price. Delivers alerts via Telegram and optionally to a hardware notifier.

## How it works

1. Fetches a public WebSocket token from KuCoin's REST API
2. Opens a WebSocket connection and subscribes to ticker topics for all configured symbols
3. Sends a ping every `pingInterval` ms to keep the connection alive
4. On each tick, computes `% change` from a baseline price (refreshed hourly by default)
5. When a threshold is crossed, emits an `AlertEvent`, sends a Telegram message, and optionally POSTs to a hardware device
6. Reconnects automatically on disconnect with a fresh token

## Project structure

```
src/
  types.ts                    shared interfaces (AlertEvent, TickerData, etc.)
  agent/
    index.ts                  entry point — wires everything together
    config.ts                 symbol list, thresholds, cooldown/refresh settings
    ws-manager.ts             WebSocket connection, token fetch, heartbeat, reconnect
    ticker-router.ts          parses KuCoin messages, routes to trackers
    price-tracker.ts          per-symbol state: baseline, current price, cycle reset
    threshold-detector.ts     threshold crossing logic + per-level cooldown
    emitter.ts                Telegram sender + hardware notifier + EventEmitter
ecosystem.config.json         PM2 config
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Telegram

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts → copy the token
2. Message your new bot anything, then open:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Find `"chat":{"id":XXXXXXXXX}` — that's your chat ID

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
TELEGRAM_TOKEN=7123456789:AAF...
TELEGRAM_CHAT_ID=123456789
DEVICE_IP=192.168.1.XXX   # optional
```

You can test Telegram is wired correctly before starting the agent:

```bash
curl "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>&text=test"
```

### 4. Run

```bash
npm start
```

## What a Telegram alert looks like

```
🟢 BTC-USDT
+4.31% — hit 4% threshold
Price: $71204.5000
Baseline: $68240.1000
```

## Configuration

Edit [src/agent/config.ts](src/agent/config.ts):

| Field | Default | Description |
|---|---|---|
| `symbols` | 50 pairs | Symbols to watch (max 50) |
| `thresholds` | `[2, 4, 10, 20]` | Alert thresholds in % |
| `baselineRefreshMs` | `3600000` (1h) | How often the baseline price resets |
| `cooldownMs` | `300000` (5m) | Per-threshold cooldown after an alert fires |

Environment variables (`.env`):

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your Telegram chat/user ID |
| `DEVICE_IP` | No | IP of a hardware notifier (POSTs `AlertEvent` as JSON to `http://<IP>/alert`) |

## Alert event shape

```ts
interface AlertEvent {
  symbol: string;        // e.g. "BTC-USDT"
  direction: 'up' | 'down';
  thresholdPct: number;  // 2, 4, 10, or 20
  currentPrice: number;
  baselinePrice: number;
  pctChange: number;     // signed actual % change
  timestamp: number;     // unix ms
}
```

You can also consume alerts programmatically via the EventEmitter:

```ts
import { alertEmitter } from './src/agent/emitter';

alertEmitter.on('alert', (event) => {
  // your notification logic here
});
```

## Running with PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.json
pm2 logs kucoin-agent
```

Add `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` to the `env` block in [ecosystem.config.json](ecosystem.config.json) before starting.
