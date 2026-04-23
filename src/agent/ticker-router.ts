import { KuCoinMessage } from '../types';
import { PriceTracker } from './price-tracker';
import { BuySellTracker } from './buy-sell-tracker';
import { detect } from './threshold-detector';
import { emitAlert } from './emitter';

export class TickerRouter {
  private tracker: PriceTracker;
  private buySellTracker: BuySellTracker;

  constructor(tracker: PriceTracker, buySellTracker: BuySellTracker) {
    this.tracker = tracker;
    this.buySellTracker = buySellTracker;
  }

  handle(msg: KuCoinMessage): void {
    if (!msg.topic || !msg.data) return;

    // topic format: /market/ticker:BTC-USDT
    const symbol = msg.topic.split(':')[1];
    if (!symbol) return;

    const rawPrice = msg.data.price;
    if (!rawPrice || rawPrice === '') return;

    const price = parseFloat(rawPrice);
    if (isNaN(price) || price <= 0) return;

    const state = this.tracker.update(symbol, price);
    if (!state || state.baselinePrice === 0) return;

    const alert = detect(state, this.tracker);
    if (alert) {
      alert.buySellRatio = this.buySellTracker.getRatio(symbol) ?? undefined;
      const ratioStr = alert.buySellRatio != null ? ` | B/S ratio: ${alert.buySellRatio.toFixed(2)}` : '';
      console.log(
        `[alert] ${alert.symbol} ${alert.direction} ${alert.thresholdPct}% | ` +
        `price: ${alert.currentPrice} | baseline: ${alert.baselinePrice} | ` +
        `change: ${alert.pctChange.toFixed(2)}%${ratioStr}`
      );
      emitAlert(alert).catch((err: Error) => console.error('[emitter] error:', err.message));
    }
  }
}
