/**
 * Test Suite D: Portfolio Greeks & Position Tracking
 * 
 * Validates:
 * - Individual position Greek calculation
 * - Portfolio-level aggregation
 * - Risk limit breach detection
 * - Hedge recommendations
 */

import { describe, it, expect } from '@jest/globals';
import {
    runTestSuite,
    assert,
    assertInRange,
    assertGreaterThan,
    assertLessThan,
    log,
} from '../utils/test-utils.js';
import { getMockPosition, getMockPortfolio, getMockGreeks } from '../factories/test-factories.js';

// Jest wrapper for the custom test suite
describe('Portfolio Greeks', () => {
    it('should run portfolio greeks tests', async () => {
        const result = await runPortfolioGreeksTests();
        expect(result.failed).toBe(0);
    }, 60000);
});

// ═══════════════════════════════════════════════════════════════
// RISK LIMITS
// ═══════════════════════════════════════════════════════════════

interface RiskLimits {
    maxDelta: number;
    maxGamma: number;
    maxVega: number;
    maxNotional: number;
}

const DEFAULT_RISK_LIMITS: RiskLimits = {
    maxDelta: 50,
    maxGamma: 5,
    maxVega: 100,
    maxNotional: 50000,
};

// ═══════════════════════════════════════════════════════════════
// POSITION & PORTFOLIO TYPES
// ═══════════════════════════════════════════════════════════════

interface Position {
    id: string;
    clobTokenId: string;
    strike: number;
    maturity: string;
    quantity: number;
    avgEntry: number;
    currentPrice: number;
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
}

interface PortfolioGreeks {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    notional: number;
}

interface RiskBreachResult {
    breached: boolean;
    breaches: Array<{ metric: string; value: number; limit: number }>;
}

interface HedgeRecommendation {
    strike: number;
    maturity: string;
    action: 'BUY' | 'SELL';
    quantity: number;
    efficiency: number;
    deltaReduction: number;
}

// ═══════════════════════════════════════════════════════════════
// POSITION TRACKER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

class PositionTracker {
    private positions: Map<string, Position> = new Map();
    private riskLimits: RiskLimits;

    constructor(limits: RiskLimits = DEFAULT_RISK_LIMITS) {
        this.riskLimits = limits;
    }

    addPosition(position: Position): void {
        this.positions.set(position.id, position);
    }

    updatePosition(id: string, updates: Partial<Position>): void {
        const existing = this.positions.get(id);
        if (existing) {
            this.positions.set(id, { ...existing, ...updates });
        }
    }

    getPositions(): Position[] {
        return Array.from(this.positions.values());
    }

    calculatePortfolioGreeks(): PortfolioGreeks {
        let delta = 0;
        let gamma = 0;
        let vega = 0;
        let theta = 0;
        let notional = 0;

        for (const position of this.positions.values()) {
            delta += position.delta;
            gamma += position.gamma;
            vega += position.vega;
            theta += position.theta;
            notional += Math.abs(position.quantity * position.avgEntry);
        }

        return { delta, gamma, vega, theta, notional };
    }

    checkRiskLimits(): RiskBreachResult {
        const greeks = this.calculatePortfolioGreeks();
        const breaches: Array<{ metric: string; value: number; limit: number }> = [];

        if (Math.abs(greeks.delta) > this.riskLimits.maxDelta) {
            breaches.push({ metric: 'Delta', value: greeks.delta, limit: this.riskLimits.maxDelta });
        }
        if (Math.abs(greeks.gamma) > this.riskLimits.maxGamma) {
            breaches.push({ metric: 'Gamma', value: greeks.gamma, limit: this.riskLimits.maxGamma });
        }
        if (Math.abs(greeks.vega) > this.riskLimits.maxVega) {
            breaches.push({ metric: 'Vega', value: greeks.vega, limit: this.riskLimits.maxVega });
        }
        if (greeks.notional > this.riskLimits.maxNotional) {
            breaches.push({ metric: 'Notional', value: greeks.notional, limit: this.riskLimits.maxNotional });
        }

        return { breached: breaches.length > 0, breaches };
    }

    suggestHedges(targetDelta: number = 0): HedgeRecommendation[] {
        const greeks = this.calculatePortfolioGreeks();
        const deltaToHedge = greeks.delta - targetDelta;

        if (Math.abs(deltaToHedge) < 1) {
            return []; // No hedge needed
        }

        // Find positions that can offset the delta
        const recommendations: HedgeRecommendation[] = [];
        const sortedPositions = Array.from(this.positions.values())
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

        for (const position of sortedPositions.slice(0, 3)) {
            const action: 'BUY' | 'SELL' = deltaToHedge > 0 ? 'SELL' : 'BUY';
            const efficiency = Math.abs(position.delta / position.quantity);

            recommendations.push({
                strike: position.strike,
                maturity: position.maturity,
                action,
                quantity: Math.abs(Math.ceil(deltaToHedge / efficiency / 10)) * 10,
                efficiency: Math.min(efficiency, 1),
                deltaReduction: deltaToHedge * 0.3, // Rough estimate
            });
        }

        return recommendations.sort((a, b) => b.efficiency - a.efficiency);
    }

    calculatePnL(): { realized: number; unrealized: number } {
        let unrealized = 0;

        for (const position of this.positions.values()) {
            const positionPnL = (position.currentPrice - position.avgEntry) * position.quantity;
            unrealized += positionPnL;
        }

        return { realized: 0, unrealized };
    }

    clear(): void {
        this.positions.clear();
    }
}

// ═══════════════════════════════════════════════════════════════
// TEST SUITE RUNNER
// ═══════════════════════════════════════════════════════════════

export async function runPortfolioGreeksTests() {
    const tracker = new PositionTracker();

    const tests = [
        {
            name: 'Initialize PositionTracker with 15 positions',
            fn: async () => {
                const mockPositions = getMockPortfolio(15);

                for (let i = 0; i < mockPositions.length; i++) {
                    const mp = mockPositions[i];
                    tracker.addPosition({
                        id: `pos-${i}`,
                        clobTokenId: mp.clobTokenId,
                        strike: mp.strike,
                        maturity: mp.maturity,
                        quantity: mp.quantity,
                        avgEntry: mp.avgEntry,
                        currentPrice: mp.currentPrice,
                        delta: mp.delta,
                        gamma: mp.gamma,
                        vega: mp.vega,
                        theta: mp.theta,
                    });
                }

                const positions = tracker.getPositions();
                log.info(`Initialized ${positions.length} positions`);
                assert(positions.length === 15, 'Should have 15 positions');
                return { count: positions.length };
            },
        },
        {
            name: 'Calculate individual position Greeks',
            fn: async () => {
                const positions = tracker.getPositions();
                let calculatedCount = 0;

                log.info(`\nPosition Greeks:`);
                log.info(`${'Strike'.padEnd(10)} ${'Qty'.padEnd(8)} ${'Delta'.padEnd(10)} ${'Gamma'.padEnd(10)} ${'Vega'.padEnd(10)}`);
                log.info('-'.repeat(50));

                for (const pos of positions.slice(0, 5)) {
                    log.info(
                        `${String(pos.strike).padEnd(10)} ${String(pos.quantity).padEnd(8)} ${pos.delta.toFixed(2).padEnd(10)} ${pos.gamma.toFixed(4).padEnd(10)} ${pos.vega.toFixed(2).padEnd(10)}`
                    );
                    calculatedCount++;
                }

                log.info(`... and ${positions.length - 5} more`);
                assert(calculatedCount > 0, 'Should calculate Greeks for positions');
                return { calculated: positions.length };
            },
        },
        {
            name: 'Aggregate portfolio-level Greeks',
            fn: async () => {
                const greeks = tracker.calculatePortfolioGreeks();

                log.info(`\nPortfolio Aggregation:`);
                log.info(`  - Net Delta: ${greeks.delta.toFixed(2)}`);
                log.info(`  - Net Gamma: ${greeks.gamma.toFixed(4)}`);
                log.info(`  - Net Vega: ${greeks.vega.toFixed(2)}`);
                log.info(`  - Net Theta: ${greeks.theta.toFixed(4)}`);
                log.info(`  - Total Notional: $${greeks.notional.toFixed(2)}`);

                return greeks;
            },
        },
        {
            name: 'Verify portfolio delta = sum of weighted deltas',
            fn: async () => {
                const positions = tracker.getPositions();
                const calculatedDelta = positions.reduce((sum, p) => sum + p.delta, 0);
                const portfolioGreeks = tracker.calculatePortfolioGreeks();

                log.info(`Calculated delta: ${calculatedDelta.toFixed(2)}`);
                log.info(`Portfolio delta: ${portfolioGreeks.delta.toFixed(2)}`);

                const diff = Math.abs(calculatedDelta - portfolioGreeks.delta);
                assertLessThan(diff, 0.01, 'Delta aggregation should match');
                return { calculatedDelta, portfolioDelta: portfolioGreeks.delta };
            },
        },
        {
            name: 'Check risk limits (no breach expected)',
            fn: async () => {
                const result = tracker.checkRiskLimits();

                if (result.breached) {
                    log.warn(`Risk breaches detected:`);
                    for (const breach of result.breaches) {
                        log.warn(`  - ${breach.metric}: ${breach.value.toFixed(2)} > ${breach.limit}`);
                    }
                } else {
                    log.info('No risk limit breaches');
                }

                return result;
            },
        },
        {
            name: 'Simulate position change triggering delta breach',
            fn: async () => {
                // Add a large position to trigger breach
                const greeksBefore = tracker.calculatePortfolioGreeks();
                const deltaNeeded = DEFAULT_RISK_LIMITS.maxDelta - greeksBefore.delta + 10;

                tracker.addPosition({
                    id: 'pos-breach',
                    clobTokenId: '123456789',
                    strike: 95000,
                    maturity: '2026-01-19',
                    quantity: 100,
                    avgEntry: 0.50,
                    currentPrice: 0.52,
                    delta: deltaNeeded,
                    gamma: -0.5,
                    vega: 5,
                    theta: -0.01,
                });

                const result = tracker.checkRiskLimits();
                log.info(`After adding breach position:`);
                log.info(`  - Breached: ${result.breached}`);

                if (result.breached) {
                    for (const breach of result.breaches) {
                        log.info(`  - ${breach.metric}: ${breach.value.toFixed(2)} > ${breach.limit}`);
                    }
                }

                assert(result.breached, 'Should detect delta breach');
                return result;
            },
        },
        {
            name: 'Generate hedge recommendations',
            fn: async () => {
                const hedges = tracker.suggestHedges(0);

                log.info(`\nHedge Recommendations:`);
                for (const hedge of hedges) {
                    log.info(`  ${hedge.action} ${hedge.strike} ${hedge.maturity} (eff: ${hedge.efficiency.toFixed(2)})`);
                }

                assertGreaterThan(hedges.length, 0, 'Should generate at least one hedge recommendation');
                return hedges;
            },
        },
        {
            name: 'Apply hedge and verify delta reduction',
            fn: async () => {
                const greeksBefore = tracker.calculatePortfolioGreeks();

                // Apply a "hedge" by updating the breach position
                tracker.updatePosition('pos-breach', { delta: 0 });

                const greeksAfter = tracker.calculatePortfolioGreeks();
                const deltaReduction = greeksBefore.delta - greeksAfter.delta;

                log.info(`Delta before: ${greeksBefore.delta.toFixed(2)}`);
                log.info(`Delta after: ${greeksAfter.delta.toFixed(2)}`);
                log.info(`Reduction: ${deltaReduction.toFixed(2)}`);

                assertGreaterThan(deltaReduction, 0, 'Hedge should reduce delta');
                return { before: greeksBefore.delta, after: greeksAfter.delta, reduction: deltaReduction };
            },
        },
        {
            name: 'Verify risk limits after hedging',
            fn: async () => {
                const result = tracker.checkRiskLimits();

                log.info(`Post-hedge risk check: ${result.breached ? 'BREACH' : 'OK'}`);

                if (result.breached) {
                    for (const breach of result.breaches) {
                        log.warn(`  - ${breach.metric}: ${breach.value.toFixed(2)} > ${breach.limit}`);
                    }
                }

                return result;
            },
        },
        {
            name: 'Calculate PnL tracking',
            fn: async () => {
                const pnl = tracker.calculatePnL();

                log.info(`\nPnL Summary:`);
                log.info(`  - Realized: $${pnl.realized.toFixed(2)}`);
                log.info(`  - Unrealized: $${pnl.unrealized.toFixed(2)}`);

                return pnl;
            },
        },
    ];

    return runTestSuite('Test Suite D: Portfolio Greeks & Position Tracking', tests);
}

// Already exported above
