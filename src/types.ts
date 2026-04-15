export interface AlertEvent {
  symbol: string;
  direction: 'up' | 'down';
  thresholdPct: number;   // 2, 4, 10, or 20
  currentPrice: number;
  baselinePrice: number;
  pctChange: number;      // actual % change (signed)
  timestamp: number;      // unix ms
}

export interface TickerData {
  price: string;
  bestBid: string;
  bestAsk: string;
  size: string;
  time: number;
}

export interface KuCoinMessage {
  type: string;
  topic?: string;
  subject?: string;
  data?: TickerData;
  id?: string;
}

export interface KuCoinTokenResponse {
  data: {
    token: string;
    instanceServers: Array<{
      endpoint: string;
      pingInterval: number;
      pingTimeout: number;
    }>;
  };
}

export interface PriceTrackerState {
  symbol: string;
  baselinePrice: number;
  currentPrice: number;
  lastAlertedThreshold: number;  // highest threshold that has fired this cycle
  baselineSetAt: number;         // unix ms when baseline was last set
}
