export const config = {
  symbols: [
    'BTC-USDT',  'ETH-USDT',  'SOL-USDT',  'BNB-USDT',  'XRP-USDT',
    'DOGE-USDT', 'ADA-USDT',  'AVAX-USDT', 'TRX-USDT',  'LINK-USDT',
    'DOT-USDT',  'MATIC-USDT','LTC-USDT',  'UNI-USDT',  'ATOM-USDT',
    'XLM-USDT',  'BCH-USDT',  'APT-USDT',  'FIL-USDT',  'ARB-USDT',
    'OP-USDT',   'NEAR-USDT', 'INJ-USDT',  'SUI-USDT',  'ICP-USDT',
    'IMX-USDT',  'VET-USDT',  'HBAR-USDT', 'ALGO-USDT', 'SAND-USDT',
    'MANA-USDT', 'AXS-USDT',  'THETA-USDT','FTM-USDT',  'EGLD-USDT',
    'FLOW-USDT', 'CHZ-USDT',  'GALA-USDT', 'ENJ-USDT',  'ROSE-USDT',
    'ZIL-USDT',  'KAVA-USDT', 'ONE-USDT',  'CELO-USDT', 'QTUM-USDT',
    'ZEC-USDT',  'XTZ-USDT',  'BAT-USDT',  'ZRX-USDT',  'ICX-USDT',
  ] as string[],

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
} as const;
