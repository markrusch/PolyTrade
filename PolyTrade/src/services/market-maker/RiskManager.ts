import { PortfolioGreeks } from '../../db/Database.js';

export interface RiskConfig {
    maxDelta: number;
    maxGamma: number;
    maxVega: number;
    maxNotional: number;
    deltaSoftLimitMultiplier: number; // e.g. 0.8 to warn
}

export class RiskManager {
    private config: RiskConfig;

    constructor(config: Partial<RiskConfig> = {}) {
        this.config = {
            maxDelta: 50,    // 50 BTC/ETH equivalent delta
            maxGamma: 5,
            maxVega: 100,
            maxNotional: 50000,
            deltaSoftLimitMultiplier: 0.8,
            ...config
        };
    }

    /**
     * Check if portfolio greeks are within limits
     * Spec 4.1: Risk Limits
     */
    public checkRisk(greeks: PortfolioGreeks): {
        safe: boolean;
        breaches: string[];
        utilization: { delta: number; gamma: number; vega: number };
    } {
        const breaches: string[] = [];

        // Check Limits
        if (Math.abs(greeks.delta) > this.config.maxDelta) {
            breaches.push(`Delta limit exceeded: ${greeks.delta.toFixed(2)} > ${this.config.maxDelta}`);
        }

        if (Math.abs(greeks.gamma) > this.config.maxGamma) {
            breaches.push(`Gamma limit exceeded: ${greeks.gamma.toFixed(2)} > ${this.config.maxGamma}`);
        }

        if (Math.abs(greeks.vega) > this.config.maxVega) {
            breaches.push(`Vega limit exceeded: ${greeks.vega.toFixed(2)} > ${this.config.maxVega}`);
        }

        if (greeks.notional > this.config.maxNotional) {
            breaches.push(`Notional limit exceeded: ${greeks.notional.toFixed(2)} > ${this.config.maxNotional}`);
        }

        // Calculate utilization
        const utilization = {
            delta: Math.abs(greeks.delta) / this.config.maxDelta,
            gamma: Math.abs(greeks.gamma) / this.config.maxGamma,
            vega: Math.abs(greeks.vega) / this.config.maxVega
        };

        return {
            safe: breaches.length === 0,
            breaches,
            utilization
        };
    }

    /**
     * Calculate required hedge quantity for a specific greek
     * Simplified version of Spec 4.2
     */
    public calculateHedge(
        currentGreek: number,
        limit: number,
        hedgeInstrumentGreekPerUnit: number
    ): number {
        // If we are above 80% utilization (soft limit), start hedging back to neutral
        const utilization = Math.abs(currentGreek) / limit;

        if (utilization > this.config.deltaSoftLimitMultiplier) {
            // Target: Reduce greek by 20% of limit or enough to get back to 0
            const excess = currentGreek;

            // Quantity = -Excess / GreekPerUnit
            // Avoid division by zero
            if (Math.abs(hedgeInstrumentGreekPerUnit) < 1e-6) return 0;

            return -excess / hedgeInstrumentGreekPerUnit;
        }

        return 0;
    }
}
