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
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol         TEXT    NOT NULL,
    direction      TEXT    NOT NULL,
    threshold_pct  INTEGER NOT NULL,
    current_price  REAL    NOT NULL,
    baseline_price REAL    NOT NULL,
    pct_change     REAL    NOT NULL,
    timestamp      INTEGER NOT NULL,
    buy_sell_ratio REAL
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_symbol    ON alerts (symbol);
`);

// Migrate existing DBs that pre-date the buy_sell_ratio column
try {
  db.exec('ALTER TABLE alerts ADD COLUMN buy_sell_ratio REAL');
} catch {
  // column already exists — safe to ignore
}

const insertStmt = db.prepare(`
  INSERT INTO alerts (symbol, direction, threshold_pct, current_price, baseline_price, pct_change, timestamp, buy_sell_ratio)
  VALUES (@symbol, @direction, @threshold_pct, @current_price, @baseline_price, @pct_change, @timestamp, @buy_sell_ratio)
`);

const recentStmt = db.prepare(`
  SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?
`);

const countStmt = db.prepare(`SELECT COUNT(*) as count FROM alerts`);

const wipeStmt = db.prepare(`DELETE FROM alerts`);

const getAllSinceStmt = db.prepare(`SELECT * FROM alerts WHERE timestamp >= ? ORDER BY timestamp DESC`);

const getBySymbolStmt = db.prepare(`
  SELECT * FROM alerts WHERE symbol = ? AND timestamp >= ? ORDER BY timestamp DESC
`);

function rowToAlertEvent(r: any): AlertEvent {
  return {
    symbol:        r.symbol,
    direction:     r.direction as 'up' | 'down',
    thresholdPct:  r.threshold_pct,
    currentPrice:  r.current_price,
    baselinePrice: r.baseline_price,
    pctChange:     r.pct_change,
    timestamp:     r.timestamp,
    buySellRatio:  r.buy_sell_ratio ?? undefined,
  };
}

function startOfTodayMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupByDirection(direction: 'up' | 'down', minSignals: number): DirectionalAsset[] {
  const rows = getAllSinceStmt.all(startOfTodayMs()) as any[];
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

export interface MonthlyTrendItem {
  symbol: string;
  alertCount: number;
  avgPctChange: number;
  latestPrice: number;
  latestTimestamp: number;
}

export interface MonthlyTrends {
  alwaysUp: MonthlyTrendItem[];
  alwaysDown: MonthlyTrendItem[];
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
      symbol:          alert.symbol,
      direction:       alert.direction,
      threshold_pct:   alert.thresholdPct,
      current_price:   alert.currentPrice,
      baseline_price:  alert.baselinePrice,
      pct_change:      alert.pctChange,
      timestamp:       alert.timestamp,
      buy_sell_ratio:  alert.buySellRatio ?? null,
    });
  },

  getRecent(limit = 50): AlertEvent[] {
    return (recentStmt.all(limit) as any[]).map(rowToAlertEvent);
  },

  count(): number {
    return (countStmt.get() as { count: number }).count;
  },

  getBySymbol(symbol: string, days = 30, limit?: number): AlertEvent[] {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = getBySymbolStmt.all(symbol, since) as any[];
    const alerts = rows.map(rowToAlertEvent);
    return limit != null ? alerts.slice(0, limit) : alerts;
  },

  monthlyTrends(): MonthlyTrends {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const rows = getAllSinceStmt.all(since) as any[];

    const bySymbol = new Map<string, AlertEvent[]>();
    for (const row of rows) {
      const arr = bySymbol.get(row.symbol) ?? [];
      arr.push(rowToAlertEvent(row));
      bySymbol.set(row.symbol, arr);
    }

    const alwaysUp: MonthlyTrendItem[] = [];
    const alwaysDown: MonthlyTrendItem[] = [];

    for (const [symbol, alerts] of bySymbol) {
      const allUp   = alerts.every(a => a.direction === 'up');
      const allDown = alerts.every(a => a.direction === 'down');
      if (!allUp && !allDown) continue;

      // alerts are ORDER BY timestamp DESC, so index 0 is newest
      const latest: MonthlyTrendItem = {
        symbol,
        alertCount:      alerts.length,
        avgPctChange:    alerts.reduce((s, a) => s + Math.abs(a.pctChange), 0) / alerts.length,
        latestPrice:     alerts[0].currentPrice,
        latestTimestamp: alerts[0].timestamp,
      };

      if (allUp)   alwaysUp.push(latest);
      else         alwaysDown.push(latest);
    }

    alwaysUp.sort((a, b) => b.alertCount - a.alertCount);
    alwaysDown.sort((a, b) => b.alertCount - a.alertCount);

    return { alwaysUp, alwaysDown };
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
