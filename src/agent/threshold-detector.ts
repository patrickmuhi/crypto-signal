import { AlertEvent, PriceTrackerState } from '../types';
import { config } from './config';
import { PriceTracker } from './price-tracker';

// Cooldown map: key = "SYMBOL:thresholdPct", value = timestamp when cooldown expires
const cooldowns = new Map<string, number>();

function cooldownKey(symbol: string, thresholdPct: number): string {
  return `${symbol}:${thresholdPct}`;
}

function isOnCooldown(symbol: string, thresholdPct: number): boolean {
  const expiry = cooldowns.get(cooldownKey(symbol, thresholdPct));
  return expiry !== undefined && Date.now() < expiry;
}

function setCooldown(symbol: string, thresholdPct: number): void {
  cooldowns.set(cooldownKey(symbol, thresholdPct), Date.now() + config.cooldownMs);
}

/**
 * Checks whether the current price state crosses any new threshold.
 * Returns an AlertEvent if a threshold fired, or null otherwise.
 * Side effects: updates lastAlertedThreshold on the tracker, resets cycle
 * when price recovers below all bands.
 */
export function detect(
  state: PriceTrackerState,
  tracker: PriceTracker,
): AlertEvent | null {
  const pctChange = tracker.pctChange(state);
  const absPct = Math.abs(pctChange);

  // Check if price has recovered below all bands — reset the cycle
  if (state.lastAlertedThreshold > 0 && absPct < config.thresholds[0]) {
    tracker.resetCycle(state.symbol);
    return null;
  }

  // Find the highest threshold crossed that is greater than lastAlertedThreshold
  let triggered: number | null = null;
  for (const t of [...config.thresholds].reverse()) {
    if (absPct >= t && t > state.lastAlertedThreshold) {
      triggered = t;
      break;
    }
  }

  if (triggered === null) return null;
  if (isOnCooldown(state.symbol, triggered)) return null;

  // Fire the alert
  setCooldown(state.symbol, triggered);
  tracker.setLastAlertedThreshold(state.symbol, triggered);

  const alert: AlertEvent = {
    symbol: state.symbol,
    direction: pctChange >= 0 ? 'up' : 'down',
    thresholdPct: triggered,
    currentPrice: state.currentPrice,
    baselinePrice: state.baselinePrice,
    pctChange,
    timestamp: Date.now(),
  };

  return alert;
}
