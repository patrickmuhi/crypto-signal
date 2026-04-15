import WebSocket from 'ws';
import axios from 'axios';
import { KuCoinTokenResponse, KuCoinMessage } from '../types';
import { config } from './config';

type MessageHandler = (msg: KuCoinMessage) => void;

interface TokenInfo {
  token: string;
  endpoint: string;
  pingInterval: number;
}

async function fetchToken(): Promise<TokenInfo> {
  const res = await axios.post<KuCoinTokenResponse>(config.tokenUrl);
  const { token, instanceServers } = res.data.data;
  const server = instanceServers[0];
  return {
    token,
    endpoint: server.endpoint,
    pingInterval: server.pingInterval,
  };
}

export class WsManager {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private onMessage: MessageHandler;
  private symbols: string[];

  constructor(symbols: string[], onMessage: MessageHandler) {
    this.symbols = symbols;
    this.onMessage = onMessage;
  }

  async connect(): Promise<void> {
    this.reconnecting = false;
    let tokenInfo: TokenInfo;
    try {
      tokenInfo = await fetchToken();
    } catch (err) {
      console.error('[ws-manager] failed to fetch token, retrying...', err);
      setTimeout(() => this.connect(), config.reconnectDelayMs);
      return;
    }

    const connectId = `agent-${Date.now()}`;
    const url = `${tokenInfo.endpoint}?token=${tokenInfo.token}&connectId=${connectId}`;

    console.log('[ws-manager] connecting...');
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[ws-manager] connected');
      this.subscribeAll();
      this.startHeartbeat(tokenInfo.pingInterval);
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      let msg: KuCoinMessage;
      try {
        msg = JSON.parse(raw.toString()) as KuCoinMessage;
      } catch {
        return;
      }
      if (msg.type === 'message') {
        this.onMessage(msg);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.warn(`[ws-manager] connection closed (${code}: ${reason.toString()}), reconnecting...`);
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[ws-manager] WS error:', err.message);
      // 'close' will fire next, triggering reconnect
    });
  }

  private subscribeAll(): void {
    // KuCoin supports batching symbols in one topic, send in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < this.symbols.length; i += chunkSize) {
      const chunk = this.symbols.slice(i, i + chunkSize);
      const msg = {
        id: `sub-${Date.now()}-${i}`,
        type: 'subscribe',
        topic: `/market/ticker:${chunk.join(',')}`,
        privateChannel: false,
        response: true,
      };
      this.ws?.send(JSON.stringify(msg));
    }
    console.log(`[ws-manager] subscribed to ${this.symbols.length} symbols`);
  }

  private startHeartbeat(intervalMs: number): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ id: `ping-${Date.now()}`, type: 'ping' }));
      }
    }, intervalMs);
  }

  private cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    setTimeout(() => this.connect(), config.reconnectDelayMs);
  }

  disconnect(): void {
    this.cleanup();
    this.ws?.close();
  }
}
