import { Side, OrderType } from '@polymarket/clob-client';
import { ClobClientWrapper } from './ClobClient';

export interface OrderParams {
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  orderType?: 'GTC' | 'GTD' | 'FOK' | 'FAK';
  expiration?: number;
}

export class OrderManager {
  constructor(private clobClient: ClobClientWrapper) {}

  async placeOrder(params: OrderParams) {
    const client = this.clobClient.getClient();
    const orderType =
      params.orderType === 'FOK'
        ? OrderType.FOK
        : params.orderType === 'FAK'
        ? OrderType.FAK
        : OrderType.GTC;

    const response = await client.createAndPostOrder(
      {
        tokenID: params.tokenId,
        side: params.side === 'BUY' ? Side.BUY : Side.SELL,
        price: params.price,
        size: params.size,
        expiration: params.expiration,
      },
      {
        tickSize: '0.01',
        negRisk: false,
      },
      orderType as OrderType.GTC | OrderType.GTD | undefined
    );
    return response;
  }

  async getOpenOrders() {
    const client = this.clobClient.getClient();
    return client.getOpenOrders();
  }

  async cancelOrder(orderId: string) {
    const client = this.clobClient.getClient();
    // Use bulk cancel endpoint for reliability; single cancel was failing with bad payload
    return client.cancelOrders([orderId]);
  }

  async cancelOrders(orderIds: string[]) {
    const client = this.clobClient.getClient();
    return client.cancelOrders(orderIds);
  }

  async cancelAll() {
    const client = this.clobClient.getClient();
    return client.cancelAll();
  }

  async cancelMarketOrders(conditionId: string) {
    const client = this.clobClient.getClient();
    return client.cancelOrders([]);
  }
}
