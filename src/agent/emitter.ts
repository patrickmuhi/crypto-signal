import EventEmitter from 'events';
import { AlertEvent } from '../types';

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DEVICE_IP        = process.env.DEVICE_IP; // optional hardware notifier

export const alertEmitter = new EventEmitter();

/**
 * Emit an alert event, send a Telegram message, and optionally notify hardware.
 * Called from ticker-router when a threshold is crossed.
 */
export async function emitAlert(alert: AlertEvent): Promise<void> {
  alertEmitter.emit('alert', alert);
  await Promise.allSettled([
    sendTelegram(alert),
    notifyHardware(alert),
  ]);
}

async function sendTelegram(alert: AlertEvent): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;

  const emoji = alert.direction === 'up' ? '🟢' : '🔴';
  const sign  = alert.direction === 'up' ? '+' : '';
  const text  = [
    `${emoji} *${alert.symbol}*`,
    `${sign}${alert.pctChange.toFixed(2)}% — hit ${alert.thresholdPct}% threshold`,
    `Price: $${alert.currentPrice.toFixed(4)}`,
    `Baseline: $${alert.baselinePrice.toFixed(4)}`,
  ].join('\n');

  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`
            + `?chat_id=${TELEGRAM_CHAT_ID}`
            + `&text=${encodeURIComponent(text)}`
            + `&parse_mode=Markdown`;

  try {
    const res = await fetch(url);
    if (!res.ok) console.warn('[telegram] failed:', await res.text());
  } catch (err: unknown) {
    console.warn('[telegram] request error:', (err as Error).message);
  }
}

async function notifyHardware(alert: AlertEvent): Promise<void> {
  if (!DEVICE_IP) return;
  try {
    await fetch(`http://${DEVICE_IP}/alert`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(alert),
      signal:  AbortSignal.timeout(2000),
    });
  } catch (err: unknown) {
    console.warn('[hardware] notification failed:', (err as Error).message);
  }
}
