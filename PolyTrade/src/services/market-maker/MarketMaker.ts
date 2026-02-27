import { DB, Market, Position } from '../../db/Database.js';
import { Strategy, Quote } from './Strategy.js';
import { RiskManager } from './RiskManager.js';
import { MarketPricingService, PricingSnapshot } from '../polymarket/MarketPricingService.js';
import { ClobClientWrapper } from '../polymarket/ClobClient.js';
import { Logger } from '../../lib/logger/index.js';
import { OrderBookService } from '../polymarket/OrderBook.js';
import { HybridStreamManager } from '../polymarket/streaming/index.js';

export interface MMConfig {
    clobClient: ClobClientWrapper;
    pricingService: MarketPricingService;
    orderBookService: OrderBookService;
    streamManager?: HybridStreamManager; // Added stream manager
    db: DB;
    userId: string; // for order self-match prevention if needed
    paperMode?: boolean;
}

export class MarketMaker {
    private db: DB;
    private strategy: Strategy;
    private riskManager: RiskManager;
    private pricingService: MarketPricingService;
    private clobClient: ClobClientWrapper;
    private orderBookService: OrderBookService;
    private streamManager?: HybridStreamManager;
    private logger: Logger;

    private isRunning: boolean = false;
    private loopIntervalMs: number = 2000; // 2s tick
    private loopTimeout: NodeJS.Timeout | null = null;
    private paperMode: boolean;

    // Runtime State
    private markets: Map<string, Market> = new Map(); // clobTokenId -> Market
    private marketMetadata: Map<string, any> = new Map(); // slug -> metadata

    // Live Market Data
    private spotPrices: { ETH: number, BTC: number } = { ETH: 0, BTC: 0 };
    private ivLevels: { ETH: number, BTC: number } = { ETH: 50, BTC: 50 }; // Default 50% IV

    constructor(config: MMConfig) {
        this.db = config.db;
        this.clobClient = config.clobClient;
        this.pricingService = config.pricingService;
        this.pricingService = config.pricingService;
        this.orderBookService = config.orderBookService;
        this.streamManager = config.streamManager;

        this.strategy = new Strategy();
        this.riskManager = new RiskManager();
        this.logger = new Logger({ level: 'info', service: 'market-maker' });
        this.paperMode = config.paperMode || false;
    }

    public async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.logger.info(`Starting Market Maker (Paper Mode: ${this.paperMode})`);

        await this.loadMarkets();
        this.runLoop();
    }

    public stop() {
        this.isRunning = false;
        if (this.loopTimeout) clearTimeout(this.loopTimeout);
        this.logger.info('Stopping Market Maker...');
    }

    private async loadMarkets() {
        const activeMarkets = this.db.getMarkets(true);
        this.markets.clear();
        activeMarkets.forEach(m => {
            this.markets.set(m.clobTokenId, m);
        });
        this.logger.info(`Loaded ${this.markets.size} active markets from DB`);
    }

    /**
     * Main Execution Loop
     * Spec Section 7.2
     */
    private async runLoop() {
        if (!this.isRunning) return;

        const start = Date.now();
        try {
            await this.tick();
        } catch (err) {
            this.logger.error('Error in MM loop', err);
        }

        const elapsed = Date.now() - start;
        const delay = Math.max(0, this.loopIntervalMs - elapsed);

        this.loopTimeout = setTimeout(() => this.runLoop(), delay);
    }

    private async tick() {
        // 1. Data Collection & Updates
        // Fetch latest positions, prices, etc is assumed to be streaming/available via services

        // 2. Portfolio Risk Check
        const greeks = await this.calculatePortfolioGreeks();
        this.db.recordGreeks(greeks);

        const riskStatus = this.riskManager.checkRisk(greeks);
        if (!riskStatus.safe) {
            this.logger.warn(`Risk limits breached: ${riskStatus.breaches.join(', ')}`);
            // TODO: Trigger Hedging Logic
            // For now, we stop quoting if risk is critical
            return;
        }

        // 3. Quote Generation & Execution
        for (const [tokenId, market] of this.markets.entries()) {
            try {
                await this.makeMarket(tokenId, market);
            } catch (e) {
                this.logger.error(`Failed to make market ${market.question}`, e);
            }
        }
    }

    public updateMarketState(type: 'SPOT' | 'IV', asset: 'ETH' | 'BTC', value: number) {
        if (type === 'SPOT') {
            this.spotPrices[asset] = value;
            // this.logger.debug(`MM: Updated SPOT ${asset} = ${value}`);
        } else {
            this.ivLevels[asset] = value;
            // this.logger.debug(`MM: Updated IV ${asset} = ${value}`);
        }
    }

    private async calculatePortfolioGreeks() {
        const positions = this.db.getPositions();
        let pfDelta = 0;
        let pfGamma = 0;
        let pfVega = 0;
        let pfTheta = 0;
        let pfNotional = 0;

        const now = Date.now();

        for (const pos of positions) {
            const market = this.markets.get(pos.clobTokenId);
            if (!market || !market.active) continue;

            const asset = market.crypto as 'ETH' | 'BTC' || 'ETH'; // Default to ETH if unknown
            const spot = this.spotPrices[asset];
            const iv = this.ivLevels[asset];

            // Skip if no price data
            if (!spot || spot <= 0) continue;

            // Calculate TTE
            const tte = (market.maturity - now) / (1000 * 60 * 60 * 24 * 365.25);
            if (tte <= 0) continue; // Expired

            const greeks = this.pricingService.calculateGreeks(
                spot,
                market.strike,
                iv,
                tte
            );

            // Scale by position size
            // Note: Option delta is 0-1. Position delta = delta * size * spot (dollar delta) OR just delta * size (share delta)
            // Crypto options usually quote delta in terms of underlying.
            // Risk limits are usually in "ETH Terms" or "USD Terms". 
            // We'll use Underlying Terms (e.g. Delta = 10 ETH).

            pfDelta += greeks.delta * pos.quantity;
            pfGamma += greeks.gamma * pos.quantity;
            pfVega += greeks.vega * pos.quantity;
            pfTheta += greeks.theta * pos.quantity;
            pfNotional += Math.abs(pos.quantity * (greeks.delta * spot)); // approx exposure
        }

        return {
            timestamp: new Date().toISOString(),
            delta: pfDelta,
            gamma: pfGamma,
            vega: pfVega,
            theta: pfTheta,
            notional: pfNotional,
            numPositions: positions.length
        };
    }

    private async makeMarket(tokenId: string, market: Market) {
        // Logic from Spec 7.2 Step 4

        // A. Get Market Data (Spot, IV)
        // Note: In a real system we would pass these in or fetch from cache to avoid latency
        // For now we rely on the services to have cached/latest data
        // We need a way to map market to params.
        // Assuming single asset (ETH) for now as typical example

        const snapshot = this.pricingService.createSnapshot(
            {
                slug: 'unknown', // TODO: Need to persist slug or reconstruct it
                title: market.question,
                endDate: new Date(market.maturity).toISOString(),
                strike: market.strike,
                clobTokenIds: [market.clobTokenId],
                outcomes: ['Yes', 'No']
            },
            null, // auto-fetch spot
            null  // auto-fetch iv
        );

        // B. Generate Quote
        const quote = this.strategy.generateQuote(snapshot);

        if (!quote) {
            // this.logger.debug(`Could not generate quote for ${market.clobTokenId}`);
            return;
        }

        // C. Post Orders (if prices changed significantly)
        // Spec says: cancel stale, post new
        // We need to compare with existing orders (omitted for brevity in this step)

        if (this.paperMode) {
            this.logger.info(`[PAPER] Quote for ${market.question}: Bid ${quote.bid} @ ${quote.mid} @ Ask ${quote.ask}`);
        } else {
            // Execute via ClobClient
            // await this.clobClient.placeOrder(...)
            // Keeping safe for now until full verification
        }
    }

    // Method to manually add market to DB for trading
    public async addMarket(slug: string) {
        const meta = await this.pricingService.fetchMarketMetadata(slug);

        // Add "Yes" token
        const yesToken = meta.clobTokenIds[0];
        const marketData: Market = {
            clobTokenId: yesToken,
            crypto: 'ETH', // Todo: extract from slug
            strike: meta.strike,
            maturity: new Date(meta.endDate).getTime(),
            question: meta.title,
            conditionId: '', // would need from Gamma
            active: 1,
            lastUpdated: new Date().toISOString()
        };

        this.db.upsertMarket(marketData);
        this.markets.set(yesToken, marketData);

        // Subscribe to real-time data
        if (this.streamManager) {
            this.streamManager.subscribeMarket(yesToken);
        }

        this.logger.info(`Added market: ${meta.title}`);
    }
}
