import 'dotenv/config';
import { config } from './config';
import { WsManager } from './ws-manager';
import { PriceTracker } from './price-tracker';
import { TickerRouter } from './ticker-router';
import { alertEmitter } from './emitter';
import { AlertEvent } from '../types';
import { getTopMovers } from './top-movers';

const SYMBOL_REFRESH_MS = 24 * 60 * 60 * 1000; // refresh symbol list every 24h

async function fetchSymbols(): Promise<string[]> {
  console.log('[agent] fetching top movers from KuCoin...');
  const { gainers, losers } = await getTopMovers(25);
  const symbols = [...new Set([...gainers, ...losers].map(m => m.symbol))].slice(0, 50);
  console.log(`[agent] top gainers: ${gainers.map(m => m.symbol).join(', ')}`);
  console.log(`[agent] top losers:  ${losers.map(m => m.symbol).join(', ')}`);
  return symbols;
}

let wsManager: WsManager | null = null;

alertEmitter.on('alert', (event: AlertEvent) => {
  const sign = event.direction === 'up' ? '+' : '';
  console.log(
    `[ALERT] ${event.symbol} ${sign}${event.pctChange.toFixed(2)}% ` +
    `(crossed ±${event.thresholdPct}%) — price: ${event.currentPrice}, ` +
    `baseline: ${event.baselinePrice}, ts: ${new Date(event.timestamp).toISOString()}`
  );
});

async function startAgent(symbols: string[]): Promise<WsManager> {
  const priceTracker = new PriceTracker(symbols);
  const tickerRouter = new TickerRouter(priceTracker);
  const manager = new WsManager(symbols, (msg) => tickerRouter.handle(msg));
  await manager.connect();
  return manager;
}

async function main(): Promise<void> {
  console.log(`[agent] thresholds: ±${config.thresholds.join('%, ±')}%`);
  console.log(`[agent] baseline refresh: ${config.baselineRefreshMs / 60000}m | cooldown: ${config.cooldownMs / 60000}m`);
  if (process.env.TELEGRAM_TOKEN) {
    console.log(`[agent] Telegram notifications enabled (chat ${process.env.TELEGRAM_CHAT_ID})`);
  }
  if (process.env.DEVICE_IP) {
    console.log(`[agent] hardware notifier: ${process.env.DEVICE_IP}`);
  }

  const symbols = await fetchSymbols();
  console.log(`[agent] starting KuCoin market monitor — watching ${symbols.length} symbols`);
  wsManager = await startAgent(symbols);

  // Refresh symbol list daily with fresh top movers
  setInterval(async () => {
    console.log('[agent] daily symbol refresh — fetching new top movers...');
    try {
      const newSymbols = await fetchSymbols();
      console.log(`[agent] restarting with ${newSymbols.length} symbols`);
      wsManager?.disconnect();
      wsManager = await startAgent(newSymbols);
    } catch (err) {
      console.error('[agent] symbol refresh failed, keeping current subscriptions:', err);
    }
  }, SYMBOL_REFRESH_MS);
}

process.on('SIGINT', () => {
  console.log('\n[agent] shutting down...');
  wsManager?.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wsManager?.disconnect();
  process.exit(0);
});

main().catch((err: Error) => {
  console.error('[agent] fatal error:', err);
  process.exit(1);
});
