/** Shape of one entry returned by GET /v1/tickers?quotes=USD (CoinPaprika). */
export interface CoinPaprikaTicker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  quotes: {
    USD: {
      price: number;
      market_cap: number;
      percent_change_24h: number | null;
    };
  };
}
