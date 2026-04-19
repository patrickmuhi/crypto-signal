import Database from 'better-sqlite3';
import path from 'path';
import { AlertEvent } from '../types';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'alerts.db');

// Ensure the data directory exists
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL mode: faster writes, safe for concurrent reads
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT    NOT NULL,
    direction     TEXT    NOT NULL,
    threshold_pct INTEGER NOT NULL,
    current_price REAL    NOT NULL,
    baseline_price REAL   NOT NULL,
    pct_change    REAL    NOT NULL,
    timestamp     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_symbol    ON alerts (symbol);
`);

const insertStmt = db.prepare(`
  INSERT INTO alerts (symbol, direction, threshold_pct, current_price, baseline_price, pct_change, timestamp)
  VALUES (@symbol, @direction, @threshold_pct, @current_price, @baseline_price, @pct_change, @timestamp)
`);

const recentStmt = db.prepare(`
  SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?
`);

const countStmt = db.prepare(`SELECT COUNT(*) as count FROM alerts`);

const wipeStmt = db.prepare(`DELETE FROM alerts`);

const getAllStmt = db.prepare(`SELECT * FROM alerts ORDER BY timestamp DESC`);

function rowToAlertEvent(r: any): AlertEvent {
  return {
    symbol:        r.symbol,
    direction:     r.direction as 'up' | 'down',
    thresholdPct:  r.threshold_pct,
    currentPrice:  r.current_price,
    baselinePrice: r.baseline_price,
    pctChange:     r.pct_change,
    timestamp:     r.timestamp,
  };
}

function groupByDirection(direction: 'up' | 'down', minSignals: number): DirectionalAsset[] {
  const rows = getAllStmt.all() as any[];
  const bySymbol = new Map<string, AlertEvent[]>();

  for (const row of rows) {
    const arr = bySymbol.get(row.symbol) ?? [];
    arr.push(rowToAlertEvent(row));
    bySymbol.set(row.symbol, arr);
  }

  const result: DirectionalAsset[] = [];
  for (const [symbol, alerts] of bySymbol) {
    if (alerts.every(a => a.direction === direction) && alerts.length >= minSignals) {
      result.push({
        symbol,
        signalCount: alerts.length,
        firstSignal: alerts[alerts.length - 1].timestamp, // oldest (alerts are DESC)
        lastSignal:  alerts[0].timestamp,                 // newest
        alerts,
      });
    }
  }

  return result.sort((a, b) => b.signalCount - a.signalCount);
}

export interface DirectionalAsset {
  symbol: string;
  signalCount: number;
  firstSignal: number;
  lastSignal: number;
  alerts: AlertEvent[];
}

export const alertDb = {
  insert(alert: AlertEvent): void {
    insertStmt.run({
      symbol:         alert.symbol,
      direction:      alert.direction,
      threshold_pct:  alert.thresholdPct,
      current_price:  alert.currentPrice,
      baseline_price: alert.baselinePrice,
      pct_change:     alert.pctChange,
      timestamp:      alert.timestamp,
    });
  },

  getRecent(limit = 50): AlertEvent[] {
    return (recentStmt.all(limit) as any[]).map(rowToAlertEvent);
  },

  count(): number {
    return (countStmt.get() as { count: number }).count;
  },

  alwaysBullish(minSignals = 2): DirectionalAsset[] {
    return groupByDirection('up', minSignals);
  },

  alwaysBearish(minSignals = 2): DirectionalAsset[] {
    return groupByDirection('down', minSignals);
  },

  // Wipe all records and reclaim disk space
  wipe(): void {
    wipeStmt.run();
    db.exec('VACUUM');
    console.log('[db] monthly wipe complete — alerts table cleared and disk reclaimed');
  },
};

// Schedule monthly wipe: 1st of each month at midnight (local time)
function msUntilNextMonthStart(): number {
  const now  = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function scheduleMonthlyWipe(): void {
  const delay = msUntilNextMonthStart();
  const next  = new Date(Date.now() + delay);
  console.log(`[db] monthly wipe scheduled for ${next.toLocaleString()} (in ${Math.round(delay / 3600000)}h)`);

  setTimeout(() => {
    alertDb.wipe();
    // Re-schedule for the 1st of the following month
    scheduleMonthlyWipe();
  }, delay);
}

scheduleMonthlyWipe();
console.log(`[db] opened at ${DB_PATH} (${alertDb.count()} existing records)`);
