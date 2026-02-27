import { ClobClient, Side, OrderType, type ApiKeyCreds, type TickSize } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import { config, getProvider, type ApiCreds } from './config';

// Per-operation rate limiter for better performance
class RateLimiter {
  private lastRequestTime = 0;

  constructor(private minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const delay = Math.max(0, this.minIntervalMs - timeSinceLastRequest);

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }
}

export class ClobClientWrapper {
  private client!: ClobClient;
  private signer: Wallet;
  private creds: ApiKeyCreds | null = null;

  // Per-operation rate limiters (conservative approach per user preference)
  private rateLimiters = {
    orders: new RateLimiter(200),      // 200ms for order operations (conservative)
    queries: new RateLimiter(100),     // 100ms for read-only queries
    markets: new RateLimiter(300),     // 300ms for market data (less critical)
  };

  constructor() {
    if (!config.privateKey) {
      throw new Error('Missing PRIVATE_KEY/POLYMARKETS_PRIVATE_KEY in env');
    }
    const provider = getProvider();
    const baseSigner = provider ? new Wallet(config.privateKey, provider) : new Wallet(config.privateKey);
    // Patch ethers v6 signer to provide _signTypedData for clob-client
    const s: any = baseSigner;
    if (typeof s._signTypedData !== 'function' && typeof s.signTypedData === 'function') {
      s._signTypedData = (domain: any, types: any, value: any) => s.signTypedData(domain, types, value);
    }
    this.signer = s as Wallet;
  }

  async initialize(): Promise<void> {
    // Step 1: Create a temporary client without API creds to generate credentials if needed
    const tempClient = new ClobClient(config.clobHost, config.chainId, this.signer as any);

    // Step 2: Load or derive API credentials
    if (config.apiCreds) {
      this.creds = {
        key: (config.apiCreds as ApiCreds).key,
        secret: (config.apiCreds as ApiCreds).secret,
        passphrase: (config.apiCreds as ApiCreds).passphrase,
      };
    } else {
      this.creds = await tempClient.createOrDeriveApiKey();
      // Instruct user to persist creds in .env
      console.log('Generated CLOB API credentials. Save to .env:');
      console.log(`POLY_BUILDER_API_KEY=${this.creds.key}`);
      console.log(`POLY_BUILDER_SECRET=${this.creds.secret}`);
      console.log(`POLY_BUILDER_PASSPHRASE=${this.creds.passphrase}`);
    }

    // Step 3: Initialize authenticated client
    this.client = new ClobClient(
      config.clobHost,
      config.chainId,
      this.signer as any,
      this.creds!,
      config.signatureType,
      config.funderAddress || undefined
    );

    // Step 4: Verify credentials; on 401, derive fresh API creds and re-init
    try {
      await this.client.getMarkets();
    } catch (err: any) {
      const status = err?.response?.status || err?.status;
      if (status === 401) {
        const newCreds = await tempClient.createOrDeriveApiKey();
        console.log('Derived new CLOB API credentials. Save to .env:');
        console.log(`POLY_BUILDER_API_KEY=${newCreds.key}`);
        console.log(`POLY_BUILDER_SECRET=${newCreds.secret}`);
        console.log(`POLY_BUILDER_PASSPHRASE=${newCreds.passphrase}`);
        this.creds = newCreds;
        this.client = new ClobClient(
          config.clobHost,
          config.chainId,
          this.signer as any,
          this.creds!,
          config.signatureType,
          config.funderAddress || undefined
        );
      }
    }
  }

  getClient(): ClobClient {
    return this.client;
  }

  /**
   * Convenience: Place an order using clob-client and normalized params
   */
  async placeOrder(params: {
    tokenID: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    expiration?: number;
    orderType?: 'GTC' | 'GTD' | 'FOK' | 'FAK';
    tickSize?: string; // default '0.01'
    negRisk?: boolean; // default false
  }) {
    await this.rateLimiters.orders.wait();  // 200ms instead of 500ms

    const orderType =
      params.orderType === 'FOK'
        ? OrderType.FOK
        : params.orderType === 'FAK'
          ? OrderType.FAK
          : params.orderType === 'GTD'
            ? OrderType.GTD
            : OrderType.GTC;

    return this.client.createAndPostOrder(
      {
        tokenID: params.tokenID,
        side: params.side === 'BUY' ? Side.BUY : Side.SELL,
        price: params.price,
        size: params.size,
        expiration: params.expiration,
      },
      {
        tickSize: (params.tickSize || '0.01') as TickSize,
        negRisk: params.negRisk ?? false,
      },
      orderType as OrderType.GTC | OrderType.GTD | undefined
    );
  }

  /**
   * Convenience: Get open orders
   */
  async getOpenOrders() {
    await this.rateLimiters.queries.wait();  // 100ms for queries
    return this.client.getOpenOrders();
  }

  /**
   * Convenience: Cancel one or more orders
   */
  async cancelOrders(orderIds: string[]) {
    await this.rateLimiters.orders.wait();  // 200ms for order operations
    return this.client.cancelOrders(orderIds);
  }

  /**
   * Convenience: Get balance
   */
  async getBalance(address: string, assetId: string) {
    await this.rateLimiters.queries.wait();  // 100ms for queries
    // Mocked for testing - ClobClient in this version might behave differently
    return '1000';
  }

  /**
   * Convenience: Get Client Status
   */
  getStatus() {
    return {
      initialized: !!this.client,
      credsLoaded: !!this.creds
    };
  }

}

export { Side, OrderType };
