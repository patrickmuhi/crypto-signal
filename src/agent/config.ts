export const config = {
  // percent thresholds — both positive and negative checked
  thresholds: [2, 4, 10, 20] as number[],

  // refresh the baseline price every hour
  baselineRefreshMs: 60 * 60 * 1000,

  // cooldown per threshold level per symbol after an alert fires
  cooldownMs: 5 * 60 * 1000,

  // KuCoin REST endpoint for token
  tokenUrl: 'https://api.kucoin.com/api/v1/bullet-public',

  // how long to wait before reconnecting after a WS drop
  reconnectDelayMs: 3000,

  // SSE server port — frontend connects here to receive alert stream
  ssePort: Number(process.env.SSE_PORT ?? 3001),
} as const;
