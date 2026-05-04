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

## Connecting a frontend

The agent runs a small HTTP server that streams alerts to any frontend in real time.

### Base URL

```
http://<your-server-ip>:3003
```

Use `localhost:3003` during local development. The port is set via `SSE_PORT` in `.env`.

### Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/alerts` | GET | SSE stream — one `alert` event per threshold cross |
| `/alerts/history` | GET | Paginated JSON of stored alerts |
| `/signals/always-bullish` | GET | Assets with only `up` signals today |
| `/signals/always-bearish` | GET | Assets with only `down` signals today |
| `/health` | GET | `{ status, clients, stored }` |

#### History query params

```
/alerts/history?limit=100&offset=0
```

#### Always-bullish / always-bearish query params

```
/signals/always-bullish?minSignals=2
/signals/always-bearish?minSignals=2
```

`minSignals` (default `2`) sets the minimum number of signals a symbol must have to appear — useful to filter out one-off crossings.

**Response shape:**

```json
{
  "date": "2026-04-19",
  "minSignals": 2,
  "count": 3,
  "assets": [
    {
      "symbol": "BTC-USDT",
      "signalCount": 14,
      "firstSignal": 1713484800000,
      "lastSignal": 1713916800000,
      "alerts": [
        {
          "symbol": "BTC-USDT",
          "direction": "up",
          "thresholdPct": 4,
          "currentPrice": 68420.50,
          "baselinePrice": 65700.00,
          "pctChange": 4.14,
          "timestamp": 1713916800000
        }
      ]
    }
  ]
}
```

`alerts` is sorted newest-first and `signalCount` always equals `alerts.length`. Results are sorted by `signalCount` descending. Only signals from midnight today (local time) onward are considered — the top-level key is `date` (`YYYY-MM-DD`).

### 1. Load history on page mount

```js
async function loadHistory(limit = 100) {
  const res  = await fetch(`http://<your-server-ip>:3003/alerts/history?limit=${limit}`);
  const json = await res.json();
  // { total: 412, limit: 100, offset: 0, data: [ ...AlertEvent ] }
  return json.data;
}
```

### 2. Subscribe to the live stream

`EventSource` is built into every browser — no library needed. It auto-reconnects if the connection drops.

```js
const es = new EventSource('http://<your-server-ip>:3003/alerts');

es.addEventListener('alert', (e) => {
  const alert = JSON.parse(e.data);
  // {
  //   symbol:        "BTC-USDT",
  //   direction:     "up",          // "up" | "down"
  //   thresholdPct:  4,             // 2 | 4 | 10 | 20
  //   currentPrice:  71204.5,
  //   baselinePrice: 68240.1,
  //   pctChange:     4.34,          // signed
  //   timestamp:     1715000000000  // unix ms
  // }
});

es.onerror = () => {
  // EventSource retries automatically — no manual reconnect needed
};

// Disconnect when done (e.g. component unmount)
es.close();
```

### 3. Full example — vanilla JS

```html
<!DOCTYPE html>
<html>
<body>
  <ul id="feed"></ul>
  <script>
    const BASE = 'http://<your-server-ip>:3003';
    const feed = document.getElementById('feed');

    function renderAlert(alert) {
      const sign  = alert.direction === 'up' ? '+' : '';
      const emoji = alert.direction === 'up' ? '🟢' : '🔴';
      const li    = document.createElement('li');
      li.textContent = `${emoji} ${alert.symbol}  ${sign}${alert.pctChange.toFixed(2)}%`
                     + `  (hit ±${alert.thresholdPct}%)`
                     + `  @ $${alert.currentPrice.toFixed(4)}`
                     + `  — ${new Date(alert.timestamp).toLocaleTimeString()}`;
      feed.prepend(li);
    }

    // Load history then stream live
    fetch(`${BASE}/alerts/history?limit=50`)
      .then(r => r.json())
      .then(({ data }) => data.forEach(renderAlert));

    const es = new EventSource(`${BASE}/alerts`);
    es.addEventListener('alert', (e) => renderAlert(JSON.parse(e.data)));
  </script>
</body>
</html>
```

### 4. React hook

```tsx
import { useEffect, useState } from 'react';

const BASE = 'http://<your-server-ip>:3003';

interface AlertEvent {
  symbol: string;
  direction: 'up' | 'down';
  thresholdPct: number;
  currentPrice: number;
  baselinePrice: number;
  pctChange: number;
  timestamp: number;
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);

  useEffect(() => {
    // Load history first
    fetch(`${BASE}/alerts/history?limit=50`)
      .then(r => r.json())
      .then(({ data }) => setAlerts(data.reverse())); // oldest → newest

    // Then stream live
    const es = new EventSource(`${BASE}/alerts`);
    es.addEventListener('alert', (e) => {
      const alert: AlertEvent = JSON.parse(e.data);
      setAlerts(prev => [...prev, alert]);
    });

    return () => es.close();
  }, []);

  return alerts;
}
```

Usage:

```tsx
export function AlertFeed() {
  const alerts = useAlerts();
  return (
    <ul>
      {[...alerts].reverse().map(a => (
        <li key={a.timestamp + a.symbol}>
          {a.direction === 'up' ? '🟢' : '🔴'} {a.symbol}
          {' '}{a.pctChange.toFixed(2)}% hit ±{a.thresholdPct}%
        </li>
      ))}
    </ul>
  );
}
```

### 5. Health check

```js
const res  = await fetch('http://<your-server-ip>:3003/health');
const data = await res.json();
// { status: "ok", clients: 2, stored: 843 }
```

### Firewall

Open port `3003` on your Hetzner server:

```bash
ufw allow 3003/tcp
```

`Access-Control-Allow-Origin: *` is set on all endpoints so there are no CORS issues from any frontend origin.

---

## Running with PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.json
pm2 logs kucoin-agent
```

Add `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` to the `env` block in [ecosystem.config.json](ecosystem.config.json) before starting.
