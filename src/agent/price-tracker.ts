import { PriceTrackerState } from '../types';
import { config } from './config';

export class PriceTracker {
  private trackers = new Map<string, PriceTrackerState>();

  constructor(symbols: string[]) {
    for (const symbol of symbols) {
      this.trackers.set(symbol, {
        symbol,
        baselinePrice: 0,
        currentPrice: 0,
        lastAlertedThreshold: 0,
        baselineSetAt: 0,
      });
    }
  }

  update(symbol: string, price: number): PriceTrackerState | null {
    const state = this.trackers.get(symbol);
    if (!state) return null;

    const now = Date.now();

    // Set baseline on first tick or after refresh interval
    if (state.baselinePrice === 0 || now - state.baselineSetAt >= config.baselineRefreshMs) {
      state.baselinePrice = price;
      state.baselineSetAt = now;
      state.lastAlertedThreshold = 0;
      console.log(`[price-tracker] baseline set for ${symbol}: ${price}`);
    }

    state.currentPrice = price;
    return state;
  }

  pctChange(state: PriceTrackerState): number {
    if (state.baselinePrice === 0) return 0;
    return ((state.currentPrice - state.baselinePrice) / state.baselinePrice) * 100;
  }

  resetCycle(symbol: string): void {
    const state = this.trackers.get(symbol);
    if (state) {
      state.lastAlertedThreshold = 0;
    }
  }

  setLastAlertedThreshold(symbol: string, threshold: number): void {
    const state = this.trackers.get(symbol);
    if (state) {
      state.lastAlertedThreshold = threshold;
    }
  }

  get(symbol: string): PriceTrackerState | undefined {
    return this.trackers.get(symbol);
  }
}
