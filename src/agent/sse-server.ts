import http, { IncomingMessage, ServerResponse } from 'http';
import { alertEmitter } from './emitter';
import { alertDb } from './db';
import { config } from './config';
import { AlertEvent } from '../types';

// Each connected SSE client gets one response object kept open
const clients = new Set<ServerResponse>();

function handleSse(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send a comment every 25s to keep proxies/browsers from closing the connection
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  clients.add(res);
  console.log(`[sse] client connected  (total: ${clients.size})`);

  // Seed new client with last 50 alerts from DB so the UI isn't blank
  const seed = alertDb.getRecent(50).reverse(); // oldest first
  for (const alert of seed) {
    res.write(formatEvent(alert));
  }

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`[sse] client disconnected (total: ${clients.size})`);
  });
}

function formatEvent(alert: AlertEvent): string {
  return `event: alert\ndata: ${JSON.stringify(alert)}\n\n`;
}

// Broadcast every new alert to all connected SSE clients
alertEmitter.on('alert', (alert: AlertEvent) => {
  const payload = formatEvent(alert);
  for (const res of clients) {
    res.write(payload);
  }
});

function parseCorsHeaders(method: string | undefined) {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...(method !== 'OPTIONS' ? { 'Content-Type': 'application/json' } : {}),
  };
}

export function startSseServer(): void {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, parseCorsHeaders('OPTIONS'));
      res.end();
      return;
    }

    // Real-time SSE stream
    if (req.url === '/alerts' && req.method === 'GET') {
      handleSse(req, res);
      return;
    }

    // Paginated history:  GET /alerts/history?limit=100&offset=0
    if (req.url?.startsWith('/alerts/history') && req.method === 'GET') {
      const url    = new URL(req.url, `http://localhost`);
      const limit  = Math.min(Number(url.searchParams.get('limit')  ?? 100), 500);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const rows   = alertDb.getRecent(limit + offset).slice(offset);
      res.writeHead(200, parseCorsHeaders('GET'));
      res.end(JSON.stringify({ total: alertDb.count(), limit, offset, data: rows }));
      return;
    }

    // Always-bullish assets today:  GET /signals/always-bullish?minSignals=2
    if (req.url?.startsWith('/signals/always-bullish') && req.method === 'GET') {
      const url        = new URL(req.url, `http://localhost`);
      const minSignals = Math.max(1, Number(url.searchParams.get('minSignals') ?? 2));
      const date       = new Date().toISOString().slice(0, 10);
      const assets     = alertDb.alwaysBullish(minSignals);
      res.writeHead(200, parseCorsHeaders('GET'));
      res.end(JSON.stringify({ date, minSignals, count: assets.length, assets }));
      return;
    }

    // Always-bearish assets today:  GET /signals/always-bearish?minSignals=2
    if (req.url?.startsWith('/signals/always-bearish') && req.method === 'GET') {
      const url        = new URL(req.url, `http://localhost`);
      const minSignals = Math.max(1, Number(url.searchParams.get('minSignals') ?? 2));
      const date       = new Date().toISOString().slice(0, 10);
      const assets     = alertDb.alwaysBearish(minSignals);
      res.writeHead(200, parseCorsHeaders('GET'));
      res.end(JSON.stringify({ date, minSignals, count: assets.length, assets }));
      return;
    }

    // Per-symbol history:  GET /alerts/history/:symbol?days=30&limit=100
    if (req.url?.startsWith('/alerts/history/') && req.method === 'GET') {
      const url    = new URL(req.url, `http://localhost`);
      const symbol = decodeURIComponent(url.pathname.slice('/alerts/history/'.length));
      const days   = Math.max(1, Number(url.searchParams.get('days')  ?? 30));
      const limit  = url.searchParams.has('limit') ? Math.max(1, Number(url.searchParams.get('limit'))) : undefined;
      const data   = alertDb.getBySymbol(symbol, days, limit);
      res.writeHead(200, parseCorsHeaders('GET'));
      res.end(JSON.stringify({ symbol, data }));
      return;
    }

    // Monthly trends:  GET /alerts/trends/monthly
    if (req.url === '/alerts/trends/monthly' && req.method === 'GET') {
      res.writeHead(200, parseCorsHeaders('GET'));
      res.end(JSON.stringify(alertDb.monthlyTrends()));
      return;
    }

    // Health check
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, parseCorsHeaders('GET'));
      res.end(JSON.stringify({ status: 'ok', clients: clients.size, stored: alertDb.count() }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(config.ssePort, () => {
    console.log(`[sse] server listening on port ${config.ssePort}`);
    console.log(`[sse] stream:         http://localhost:${config.ssePort}/alerts`);
    console.log(`[sse] history:        http://localhost:${config.ssePort}/alerts/history`);
    console.log(`[sse] always-bullish: http://localhost:${config.ssePort}/signals/always-bullish`);
    console.log(`[sse] always-bearish: http://localhost:${config.ssePort}/signals/always-bearish`);
    console.log(`[sse] symbol history: http://localhost:${config.ssePort}/alerts/history/:symbol`);
    console.log(`[sse] monthly trends: http://localhost:${config.ssePort}/alerts/trends/monthly`);
    console.log(`[sse] health:         http://localhost:${config.ssePort}/health`);
  });
}
