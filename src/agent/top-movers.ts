import 'dotenv/config';

interface Ticker {
  symbol:     string;
  last:       string;
  changeRate: string; // 24h change as decimal e.g. "0.0431" = +4.31%
  volValue:   string; // 24h volume in USDT
}

export interface Mover {
  symbol:    string;
  price:     number;
  changePct: number; // e.g. 4.31
  volumeUsd: number;
}

export async function getTopMovers(n = 10): Promise<{ gainers: Mover[]; losers: Mover[] }> {
  const res  = await fetch('https://api.kucoin.com/api/v1/market/allTickers');
  const json = await res.json() as { data: { ticker: Ticker[] } };

  const tickers: Mover[] = (json.data.ticker)
    .filter(t => t.symbol.endsWith('-USDT'))
    .filter(t => t.changeRate && t.last && t.volValue)
    .filter(t => parseFloat(t.volValue) > 100_000) // skip low-volume pairs
    .map(t => ({
      symbol:    t.symbol,
      price:     parseFloat(t.last),
      changePct: parseFloat(t.changeRate) * 100,
      volumeUsd: parseFloat(t.volValue),
    }));

  const sorted = [...tickers].sort((a, b) => b.changePct - a.changePct);

  return {
    gainers: sorted.slice(0, n),
    losers:  sorted.slice(-n).reverse(),
  };
}
