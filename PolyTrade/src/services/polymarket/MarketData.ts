import { ClobClientWrapper } from './ClobClient';

export interface Market {
  id: string;
  question: string;
  tokens: {
    YES: { tokenId: string; price: number };
    NO: { tokenId: string; price: number };
  };
  volume?: number;
  liquidity?: number;
}

export class MarketData {
  constructor(private clobClient: ClobClientWrapper) {}

  async getMarkets(): Promise<Market[]> {
    const client = this.clobClient.getClient();
    const markets = await client.getMarkets();
    return (markets as unknown as any[]).map((m: any) => ({
      id: m.condition_id,
      question: m.question,
      tokens: {
        YES: { tokenId: m.tokens?.[0]?.token_id, price: Number(m.tokens?.[0]?.price ?? 0) },
        NO: { tokenId: m.tokens?.[1]?.token_id, price: Number(m.tokens?.[1]?.price ?? 0) },
      },
      volume: Number(m.volume ?? 0),
      liquidity: Number(m.liquidity ?? 0),
    }));
  }

  async getOrderbook(tokenId: string) {
    const client = this.clobClient.getClient();
    const ob = await client.getOrderBook(tokenId);
    return {
      bids: (ob.bids || []).map((b: any) => ({ price: Number(b.price), size: Number(b.size) })),
      asks: (ob.asks || []).map((a: any) => ({ price: Number(a.price), size: Number(a.size) })),
    };
  }

  async getPrice(tokenId: string, side: 'BUY' | 'SELL'): Promise<number> {
    const client = this.clobClient.getClient();
    const price = await client.getPrice(tokenId, side);
    return Number(price.price);
  }
}
