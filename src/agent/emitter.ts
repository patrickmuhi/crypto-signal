import EventEmitter from 'events';
import { AlertEvent } from '../types';
import { alertDb } from './db';

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DEVICE_IP        = process.env.DEVICE_IP; // optional hardware notifier

export const alertEmitter = new EventEmitter();

/**
 * Save to DB, emit locally, send Telegram, and optionally notify hardware.
 * Called from ticker-router when a threshold is crossed.
 */
export async function emitAlert(alert: AlertEvent): Promise<void> {
  alertDb.insert(alert);
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
  const ratioLine = alert.buySellRatio != null
    ? `B/S Ratio: ${alert.buySellRatio.toFixed(2)} (${alert.buySellRatio >= 1.5 ? 'buy pressure' : alert.buySellRatio <= 0.7 ? 'sell pressure' : 'balanced'})`
    : null;

  const lines = [
    `${emoji} *${alert.symbol}*`,
    `${sign}${alert.pctChange.toFixed(2)}% — hit ${alert.thresholdPct}% threshold`,
    `Price: $${alert.currentPrice.toFixed(4)}`,
    `Baseline: $${alert.baselinePrice.toFixed(4)}`,
  ];
  if (ratioLine) lines.push(ratioLine);
  const text = lines.join('\n');

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
