import { KuCoinMessage } from '../types';
import { PriceTracker } from './price-tracker';
import { detect } from './threshold-detector';
import { emitAlert } from './emitter';

export class TickerRouter {
  private tracker: PriceTracker;

  constructor(tracker: PriceTracker) {
    this.tracker = tracker;
  }

  handle(msg: KuCoinMessage): void {
    if (!msg.topic || !msg.data) return;

    // topic format: /market/ticker:BTC-USDT
    const symbol = msg.topic.split(':')[1];
    if (!symbol) return;

    const rawPrice = msg.data.price;
    if (!rawPrice || rawPrice === '') return; // skip empty price fields

    const price = parseFloat(rawPrice);
    if (isNaN(price) || price <= 0) return;

    const state = this.tracker.update(symbol, price);
    if (!state || state.baselinePrice === 0) return; // skip until baseline is set

    const alert = detect(state, this.tracker);
    if (alert) {
      console.log(
        `[alert] ${alert.symbol} ${alert.direction} ${alert.thresholdPct}% | ` +
        `price: ${alert.currentPrice} | baseline: ${alert.baselinePrice} | ` +
        `change: ${alert.pctChange.toFixed(2)}%`
      );
      emitAlert(alert).catch((err: Error) => console.error('[emitter] error:', err.message));
    }
  }
}
