import 'dotenv/config';
import { config } from './config';
import { WsManager } from './ws-manager';
import { PriceTracker } from './price-tracker';
import { TickerRouter } from './ticker-router';
import { alertEmitter } from './emitter';
import { AlertEvent } from '../types';

const priceTracker = new PriceTracker(config.symbols as unknown as string[]);
const tickerRouter = new TickerRouter(priceTracker);
const wsManager = new WsManager(config.symbols as unknown as string[], (msg) => tickerRouter.handle(msg));

// Log every alert to stdout — replace or extend with your own consumer
alertEmitter.on('alert', (event: AlertEvent) => {
  const sign = event.direction === 'up' ? '+' : '';
  console.log(
    `[ALERT] ${event.symbol} ${sign}${event.pctChange.toFixed(2)}% ` +
    `(crossed ±${event.thresholdPct}%) — price: ${event.currentPrice}, ` +
    `baseline: ${event.baselinePrice}, ts: ${new Date(event.timestamp).toISOString()}`
  );
});

async function main(): Promise<void> {
  console.log(`[agent] starting KuCoin market monitor — watching ${config.symbols.length} symbols`);
  console.log(`[agent] thresholds: ±${config.thresholds.join('%, ±')}%`);
  console.log(`[agent] baseline refresh: ${config.baselineRefreshMs / 60000}m | cooldown: ${config.cooldownMs / 60000}m`);
  if (process.env.TELEGRAM_TOKEN) {
    console.log(`[agent] Telegram notifications enabled (chat ${process.env.TELEGRAM_CHAT_ID})`);
  }
  if (process.env.DEVICE_IP) {
    console.log(`[agent] hardware notifier: ${process.env.DEVICE_IP}`);
  }

  await wsManager.connect();
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[agent] shutting down...');
  wsManager.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wsManager.disconnect();
  process.exit(0);
});

main().catch((err: Error) => {
  console.error('[agent] fatal error:', err);
  process.exit(1);
});
