import { MarketMetadata, PricingSnapshot } from '../polymarket/MarketPricingService.js';
import { Logger } from '../../lib/logger/index.js';
import { PortfolioGreeks } from './PortfolioGreeks.js';
import { InventoryTracker } from './InventoryTracker.js';

export interface Quote {
    bid: number;
    ask: number;
    mid: number;
    spread: number;
}

export interface StrategyConfig {
    baseSpread: number; // e.g., 0.02 (2%)
    gammaCoefficient: number; // k_gamma, e.g., 100
    inventoryCoefficient: number; // k_inv, e.g., 0.0001
    minSpread: number; // e.g., 0.005 (0.5%)
    maxSpread: number; // e.g., 0.10 (10%)
}

export class Strategy {
    private logger?: Logger;
    private portfolioGreeks?: PortfolioGreeks;
    private inventoryTracker?: InventoryTracker;
    private config: StrategyConfig;

    constructor(
        logger?: Logger,
        portfolioGreeks?: PortfolioGreeks,
        inventoryTracker?: InventoryTracker,
        config?: Partial<StrategyConfig>,
    ) {
        this.logger = logger?.child('Strategy');
        this.portfolioGreeks = portfolioGreeks;
        this.inventoryTracker = inventoryTracker;

        // Default configuration
        this.config = {
            baseSpread: config?.baseSpread ?? 0.02,
            gammaCoefficient: config?.gammaCoefficient ?? 100,
            inventoryCoefficient: config?.inventoryCoefficient ?? 0.0001,
            minSpread: config?.minSpread ?? 0.005,
            maxSpread: config?.maxSpread ?? 0.10,
        };

        this.logger?.info('Strategy initialized', {
            baseSpread: (this.config.baseSpread * 100).toFixed(2) + '%',
            gammaCoefficient: this.config.gammaCoefficient,
            inventoryCoefficient: this.config.inventoryCoefficient,
            qpEnabled: !!(portfolioGreeks && inventoryTracker),
        });
    }

    /**
     * Determine optimal spread and generate quotes
     * Based on Spec Section 5: Spread Determination
     * Enhanced with QP adjustments for gamma risk and inventory
     */
    public generateQuote(
        snapshot: PricingSnapshot,
        tokenId?: string,
        crypto?: string,
        marketConfig?: {
            minSpread: number;
            maxSpread: number;
        },
    ): Quote | null {

        const { fairPrice, spot, strike, tte, iv } = snapshot;

        if (!fairPrice || !spot || !iv) {
            return null;
        }

        // Use provided config or default from constructor
        const minSpread = marketConfig?.minSpread ?? this.config.minSpread;
        const maxSpread = marketConfig?.maxSpread ?? this.config.maxSpread;

        // 1. Calculate Base Min Spread
        let baseSpread = this.config.baseSpread;

        // 2. Risk Adjustments (Spec 5.2)

        // ATM Penalty (Higher spread near ATM)
        // moneyness m = |ln(K/S)|
        const m = Math.abs(Math.log(strike / spot));
        const r_ATM = 1 + 0.5 * Math.exp(-(m * m) / 0.1);

        // Maturity Penalty (Higher spread for longer dated)
        // r_T = 1 + 0.3 * (T / 1.0)
        const r_T = 1 + 0.3 * tte;

        // QP Adjustment: Gamma Risk Penalty
        // Widen spread when portfolio gamma exposure is high
        let r_gamma = 1.0;
        if (crypto && this.portfolioGreeks) {
            const portfolioGamma = this.portfolioGreeks.getGammaForCrypto(crypto);
            const k_gamma = this.config.gammaCoefficient;
            r_gamma = 1 + k_gamma * Math.abs(portfolioGamma);

            if (Math.abs(portfolioGamma) > 0.001) {
                this.logger?.debug(`Gamma adjustment for ${crypto}`, {
                    portfolioGamma: portfolioGamma.toFixed(6),
                    r_gamma: r_gamma.toFixed(4),
                });
            }
        }

        const r_total = r_ATM * r_T * r_gamma;

        let adjustedSpread = baseSpread * r_total;

        // 3. Clipping (Spec 5.5)
        adjustedSpread = Math.max(minSpread, Math.min(adjustedSpread, maxSpread));

        // 4. Calculate Final Prices
        const mid = fairPrice;

        // QP Adjustment: Inventory Skew
        // Skew quotes to encourage mean reversion
        // If long, lower both bid/ask to encourage selling
        // If short, raise both bid/ask to encourage buying
        let inventorySkew = 0;
        if (tokenId && this.inventoryTracker) {
            const inventory = this.inventoryTracker.getQuantity(tokenId);
            const k_inv = this.config.inventoryCoefficient;
            inventorySkew = -k_inv * inventory;

            if (Math.abs(inventory) > 10) {
                this.logger?.debug(`Inventory skew for ${tokenId}`, {
                    inventory,
                    inventorySkew: inventorySkew.toFixed(6),
                });
            }
        }

        let bid = mid - (adjustedSpread / 2) + inventorySkew;
        let ask = mid + (adjustedSpread / 2) + inventorySkew;

        // Ensure valid range [0.01, 0.99]
        bid = Math.max(0.01, Math.min(bid, 0.99));
        ask = Math.max(0.01, Math.min(ask, 0.99));

        // Ensure bid < ask
        if (bid >= ask) {
            // Look wide if spread collapsed
            const center = (bid + ask) / 2;
            bid = Math.max(0.01, center - 0.005);
            ask = Math.min(0.99, center + 0.005);
        }

        // Return formatted quote
        return {
            bid: Number(bid.toFixed(4)),
            ask: Number(ask.toFixed(4)),
            mid: Number(mid.toFixed(4)),
            spread: Number((ask - bid).toFixed(4))
        };
    }
}
