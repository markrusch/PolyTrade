import { ClobClientWrapper } from './ClobClient';

export interface Position {
  tokenId: string;
  marketName: string;
  side: 'YES' | 'NO';
  size: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
}

export class PositionTracker {
  private positions: Map<string, Position> = new Map();

  constructor(private clobClient: ClobClientWrapper) {}

  async updatePositions(): Promise<Position[]> {
    const client = this.clobClient.getClient();

    // Fetch trades for position calculation
    const trades: any[] = await client.getTrades();

    const positionMap = new Map<
      string,
      {
        totalBought: number;
        totalSold: number;
        avgBuyPrice: number;
        avgSellPrice: number;
        marketName?: string;
      }
    >();

    trades.forEach((trade) => {
      const key = trade.asset_id;
      const existing = positionMap.get(key) || {
        totalBought: 0,
        totalSold: 0,
        avgBuyPrice: 0,
        avgSellPrice: 0,
        marketName: trade.market_name || 'Unknown',
      };

      const size = Number(trade.size);
      const price = Number(trade.price);

      if (String(trade.side).toUpperCase() === 'BUY') {
        const prevQty = existing.totalBought;
        existing.totalBought = prevQty + size;
        existing.avgBuyPrice = prevQty === 0 ? price : (existing.avgBuyPrice * prevQty + price * size) / (prevQty + size);
      } else {
        const prevQty = existing.totalSold;
        existing.totalSold = prevQty + size;
        existing.avgSellPrice = prevQty === 0 ? price : (existing.avgSellPrice * prevQty + price * size) / (prevQty + size);
      }

      positionMap.set(key, existing);
    });

    // Update positions list
    this.positions.clear();
    for (const [tokenId, data] of positionMap.entries()) {
      const netSize = data.totalBought - data.totalSold;
      if (Math.abs(netSize) > 1e-6) {
        const currentPrice = await this.getCurrentMidPrice(tokenId);
        const avgPrice = netSize > 0 ? data.avgBuyPrice : data.avgSellPrice;
        const pnl = (currentPrice - avgPrice) * Math.abs(netSize) * (netSize > 0 ? 1 : -1);
        this.positions.set(tokenId, {
          tokenId,
          marketName: data.marketName || 'Unknown',
          side: netSize > 0 ? 'YES' : 'NO',
          size: Math.abs(netSize),
          avgPrice,
          currentPrice,
          pnl,
        });
      }
    }

    return Array.from(this.positions.values());
  }

  getPosition(tokenId: string): Position | undefined {
    return this.positions.get(tokenId);
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  private async getCurrentMidPrice(tokenId: string): Promise<number> {
    const client = this.clobClient.getClient();
    const ob = await client.getOrderBook(tokenId);
    const bestBid = ob.bids?.length ? Number(ob.bids[0].price) : 0;
    const bestAsk = ob.asks?.length ? Number(ob.asks[0].price) : 0;
    if (bestBid && bestAsk) return (bestBid + bestAsk) / 2;
    return bestBid || bestAsk || 0;
  }

  async closePosition(tokenId: string) {
    const position = this.positions.get(tokenId);
    if (!position) throw new Error('Position not found');
    const { OrderManager } = await import('./OrderManager');
    const orderManager = new OrderManager(this.clobClient);
    const oppositeSide = position.side === 'YES' ? 'SELL' : 'BUY';
    return orderManager.placeOrder({
      tokenId: position.tokenId,
      side: oppositeSide,
      price: position.currentPrice,
      size: position.size,
      orderType: 'FOK',
    });
  }
}
