import { KuCoinMessage } from '../types';

interface TradeEntry {
  side: 'buy' | 'sell';
  size: number;
  ts: number;
}

const WINDOW_MS = 60_000; // rolling 60-second window

export class BuySellTracker {
  private trades = new Map<string, TradeEntry[]>();

  handle(msg: KuCoinMessage): void {
    if (!msg.topic || !msg.data) return;

    // topic format: /market/match:BTC-USDT
    const symbol = msg.topic.split(':')[1];
    if (!symbol) return;

    const data = msg.data as unknown as Record<string, string>;
    const side = data['side'];
    if (side !== 'buy' && side !== 'sell') return;

    const size = parseFloat(data['size']);
    if (isNaN(size) || size <= 0) return;

    const now = Date.now();
    const entries = this.trades.get(symbol) ?? [];
    entries.push({ side, size, ts: now });

    // prune entries outside the rolling window
    const cutoff = now - WINDOW_MS;
    const pruned = entries.filter(e => e.ts >= cutoff);
    this.trades.set(symbol, pruned);
  }

  // Returns buy/sell volume ratio over the last 60s.
  // > 1 = buy pressure, < 1 = sell pressure. null if no data.
  getRatio(symbol: string): number | null {
    const entries = this.trades.get(symbol);
    if (!entries || entries.length === 0) return null;

    const cutoff = Date.now() - WINDOW_MS;
    const recent = entries.filter(e => e.ts >= cutoff);
    if (recent.length === 0) return null;

    let buyVol = 0;
    let sellVol = 0;
    for (const e of recent) {
      if (e.side === 'buy') buyVol += e.size;
      else sellVol += e.size;
    }

    if (sellVol === 0) return buyVol > 0 ? 99 : null;
    return Math.min(buyVol / sellVol, 99);
  }

  getVolume(symbol: string): number | null {
    const entries = this.trades.get(symbol);
    if (!entries || entries.length === 0) return null;

    const cutoff = Date.now() - WINDOW_MS;
    const recent = entries.filter(e => e.ts >= cutoff);
    if (recent.length === 0) return null;

    return recent.reduce((sum, e) => sum + e.size, 0);
  }
}
