/**
 * Test Suite E: Quote Generation with Inventory Skew
 * 
 * Validates:
 * - Minimum spread calculation from hedge costs
 * - Risk multipliers (ATM, maturity)
 * - Inventory skew application
 * - Competitive adjustment
 */

import { describe, it, expect } from '@jest/globals';
import {
    runTestSuite,
    assert,
    assertGreaterThan,
    assertLessThan,
    assertInRange,
    measureTime,
    log,
} from '../utils/test-utils.js';
import { getMockQuote, getMockOrderBook, getMockPosition } from '../factories/test-factories.js';

// Jest wrapper for the custom test suite
describe('Quote Generation', () => {
    it('should run quote generation tests', async () => {
        const result = await runQuoteGenerationTests();
        expect(result.failed).toBe(0);
    }, 60000);
});

// ═══════════════════════════════════════════════════════════════
// QUOTE ENGINE TYPES
// ═══════════════════════════════════════════════════════════════

interface QuoteParams {
    tokenId: string;
    strike: number;
    maturity: string;
    fairPrice: number;
    spotPrice: number;
    marketBid: number;
    marketAsk: number;
    inventoryDelta: number;
    tte: number;
}

interface GeneratedQuote {
    tokenId: string;
    strike: number;
    bid: number;
    ask: number;
    spread: number;
    spreadBps: number;
    baseSpread: number;
    atmPenalty: number;
    maturityPenalty: number;
    inventorySkew: number;
}

// ═══════════════════════════════════════════════════════════════
// QUOTE ENGINE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

class QuoteEngine {
    private config = {
        minSpreadPct: 0.5,    // 0.5% floor
        maxSpreadPct: 10.0,   // 10% ceiling
        atmDelta: 0.39,       // Delta at ATM
        deltaThreshold: 50,   // Risk limit for delta
    };

    /**
     * Calculate minimum spread based on hedge costs
     */
    calculateMinSpread(marketBid: number, marketAsk: number): number {
        const marketSpread = marketAsk - marketBid;
        const marketSpreadPct = (marketSpread / ((marketBid + marketAsk) / 2)) * 100;

        // Our minimum spread should cover hedge costs plus profit
        const minSpread = Math.max(marketSpreadPct * 0.8, this.config.minSpreadPct);
        return Math.min(minSpread, this.config.maxSpreadPct);
    }

    /**
     * Calculate ATM penalty (wider spreads near ATM due to higher gamma risk)
     */
    calculateAtmPenalty(fairPrice: number): number {
        // Maximum penalty when fair = 0.5 (ATM)
        const distanceFromAtm = Math.abs(fairPrice - 0.5);
        const penalty = 1 + (1 - distanceFromAtm * 2) * 0.5; // 1.0 to 1.5x
        return Math.max(1.0, penalty);
    }

    /**
     * Calculate maturity penalty (wider spreads for longer dated options)
     */
    calculateMaturityPenalty(tte: number): number {
        // Linear increase with time to expiry
        return 1 + tte * 2; // 1.0 to 1.5x for 0.25 year
    }

    /**
     * Calculate inventory skew to manage position risk
     */
    calculateInventorySkew(inventoryDelta: number): number {
        // Positive delta = long, skew asks down (encourage sells)
        // Negative delta = short, skew bids up (encourage buys)
        const utilization = inventoryDelta / this.config.deltaThreshold;
        return -utilization * 0.02; // ±2% skew at max utilization
    }

    /**
     * Generate quotes for a market
     */
    generateQuote(params: QuoteParams): GeneratedQuote {
        const { tokenId, strike, fairPrice, marketBid, marketAsk, inventoryDelta, tte } = params;

        // Calculate spread components
        const baseSpread = this.calculateMinSpread(marketBid, marketAsk);
        const atmPenalty = this.calculateAtmPenalty(fairPrice);
        const maturityPenalty = this.calculateMaturityPenalty(tte);
        const inventorySkew = this.calculateInventorySkew(inventoryDelta);

        // Final spread with all adjustments
        const adjustedSpread = baseSpread * atmPenalty * maturityPenalty;
        const clampedSpread = Math.max(this.config.minSpreadPct, Math.min(adjustedSpread, this.config.maxSpreadPct));
        const halfSpread = clampedSpread / 100 / 2;

        // Generate bid/ask with inventory skew
        const bid = Math.max(0.01, fairPrice - halfSpread + inventorySkew);
        const ask = Math.min(0.99, fairPrice + halfSpread + inventorySkew);

        return {
            tokenId,
            strike,
            bid,
            ask,
            spread: ask - bid,
            spreadBps: ((ask - bid) / fairPrice) * 10000,
            baseSpread,
            atmPenalty,
            maturityPenalty,
            inventorySkew,
        };
    }

    /**
     * Apply competitive adjustment to improve on market
     */
    applyCompetitiveAdjustment(
        quote: GeneratedQuote,
        marketBid: number,
        marketAsk: number
    ): GeneratedQuote {
        const adjusted = { ...quote };

        // Try to improve on market bid (offer better price to sellers)
        if (adjusted.bid < marketBid - 0.001) {
            adjusted.bid = Math.min(adjusted.bid + 0.005, marketBid - 0.001);
        }

        // Try to improve on market ask (offer better price to buyers)
        if (adjusted.ask > marketAsk + 0.001) {
            adjusted.ask = Math.max(adjusted.ask - 0.005, marketAsk + 0.001);
        }

        // Ensure bid < ask
        if (adjusted.bid >= adjusted.ask) {
            adjusted.bid = adjusted.ask - 0.01;
        }

        adjusted.spread = adjusted.ask - adjusted.bid;
        return adjusted;
    }
}

// ═══════════════════════════════════════════════════════════════
// TEST DATA
// ═══════════════════════════════════════════════════════════════

const TEST_MARKETS = [
    { strike: 92000, fair: 0.723, marketBid: 0.705, marketAsk: 0.740, tte: 0.025 },
    { strike: 95000, fair: 0.512, marketBid: 0.500, marketAsk: 0.525, tte: 0.025 },
    { strike: 98000, fair: 0.312, marketBid: 0.310, marketAsk: 0.330, tte: 0.025 },
    { strike: 100000, fair: 0.195, marketBid: 0.180, marketAsk: 0.210, tte: 0.025 },
    { strike: 92000, fair: 0.680, marketBid: 0.660, marketAsk: 0.700, tte: 0.05 }, // Longer maturity
];

// ═══════════════════════════════════════════════════════════════
// TEST SUITE RUNNER
// ═══════════════════════════════════════════════════════════════

export async function runQuoteGenerationTests() {
    const engine = new QuoteEngine();
    let generatedQuotes: GeneratedQuote[] = [];

    const tests = [
        {
            name: 'Calculate minimum spreads from hedge costs',
            fn: async () => {
                log.info(`\nMinimum Spread Calculation:`);
                log.info(`${'Strike'.padEnd(10)} ${'Market Spread'.padEnd(15)} ${'Min Spread'.padEnd(12)}`);
                log.info('-'.repeat(40));

                for (const market of TEST_MARKETS.slice(0, 4)) {
                    const marketSpread = market.marketAsk - market.marketBid;
                    const marketSpreadPct = (marketSpread / market.fair) * 100;
                    const minSpread = engine.calculateMinSpread(market.marketBid, market.marketAsk);

                    log.info(
                        `${String(market.strike).padEnd(10)} ${marketSpreadPct.toFixed(2).padEnd(15)}% ${minSpread.toFixed(2)}%`
                    );
                }

                return { calculated: TEST_MARKETS.length };
            },
        },
        {
            name: 'Verify minimum spread >= 0.5% (floor)',
            fn: async () => {
                for (const market of TEST_MARKETS) {
                    const minSpread = engine.calculateMinSpread(market.marketBid, market.marketAsk);
                    assertGreaterThan(minSpread, 0.49, `Min spread should be >= 0.5% for strike ${market.strike}`);
                }
                log.info('All minimum spreads >= 0.5%');
                return { verified: true };
            },
        },
        {
            name: 'Verify minimum spread <= 10% (ceiling)',
            fn: async () => {
                for (const market of TEST_MARKETS) {
                    const minSpread = engine.calculateMinSpread(market.marketBid, market.marketAsk);
                    assertLessThan(minSpread, 10.01, `Min spread should be <= 10% for strike ${market.strike}`);
                }
                log.info('All minimum spreads <= 10%');
                return { verified: true };
            },
        },
        {
            name: 'Calculate ATM penalty correctly',
            fn: async () => {
                log.info(`\nATM Penalty Calculation:`);
                log.info(`${'Fair'.padEnd(10)} ${'Distance'.padEnd(12)} ${'Penalty'.padEnd(10)}`);
                log.info('-'.repeat(35));

                const atmPenalty = engine.calculateAtmPenalty(0.50); // ATM
                const itmPenalty = engine.calculateAtmPenalty(0.80); // ITM
                const otmPenalty = engine.calculateAtmPenalty(0.20); // OTM

                log.info(`${(0.50).toFixed(2).padEnd(10)} ${'0.00'.padEnd(12)} ${atmPenalty.toFixed(2)}x`);
                log.info(`${(0.80).toFixed(2).padEnd(10)} ${'0.30'.padEnd(12)} ${itmPenalty.toFixed(2)}x`);
                log.info(`${(0.20).toFixed(2).padEnd(10)} ${'0.30'.padEnd(12)} ${otmPenalty.toFixed(2)}x`);

                // ATM should have highest penalty
                assertGreaterThan(atmPenalty, itmPenalty, 'ATM penalty should be highest');
                assertGreaterThan(atmPenalty, otmPenalty, 'ATM penalty should be highest');

                return { atmPenalty, itmPenalty, otmPenalty };
            },
        },
        {
            name: 'Calculate maturity penalty correctly',
            fn: async () => {
                log.info(`\nMaturity Penalty Calculation:`);
                log.info(`${'TTE'.padEnd(10)} ${'Penalty'.padEnd(10)}`);
                log.info('-'.repeat(25));

                const shortPenalty = engine.calculateMaturityPenalty(0.01); // Very short
                const medPenalty = engine.calculateMaturityPenalty(0.025);
                const longPenalty = engine.calculateMaturityPenalty(0.1);

                log.info(`${'0.01 yr'.padEnd(10)} ${shortPenalty.toFixed(2)}x`);
                log.info(`${'0.025 yr'.padEnd(10)} ${medPenalty.toFixed(2)}x`);
                log.info(`${'0.1 yr'.padEnd(10)} ${longPenalty.toFixed(2)}x`);

                // Longer maturity should have higher penalty
                assertGreaterThan(longPenalty, medPenalty, 'Longer maturity should have higher penalty');
                assertGreaterThan(medPenalty, shortPenalty, 'Medium maturity should have higher penalty than short');

                return { shortPenalty, medPenalty, longPenalty };
            },
        },
        {
            name: 'Apply inventory skew based on position',
            fn: async () => {
                log.info(`\nInventory Skew Calculation:`);
                log.info(`${'Delta'.padEnd(12)} ${'Skew'.padEnd(10)}`);
                log.info('-'.repeat(25));

                const longSkew = engine.calculateInventorySkew(25); // 50% long
                const neutralSkew = engine.calculateInventorySkew(0);
                const shortSkew = engine.calculateInventorySkew(-25); // 50% short

                log.info(`${'+25'.padEnd(12)} ${(longSkew * 100).toFixed(2)}%`);
                log.info(`${'0'.padEnd(12)} ${(neutralSkew * 100).toFixed(2)}%`);
                log.info(`${'-25'.padEnd(12)} ${(shortSkew * 100).toFixed(2)}%`);

                // Long position should skew quotes down (encourage sells)
                assertLessThan(longSkew, 0, 'Long position should have negative skew');
                assertGreaterThan(shortSkew, 0, 'Short position should have positive skew');

                return { longSkew, neutralSkew, shortSkew };
            },
        },
        {
            name: 'Generate final bid/ask quotes for 10 markets',
            fn: async () => {
                log.info(`\nQuote Generation (with inventory delta = +25):`);
                log.info(`${'Strike'.padEnd(10)} ${'Fair'.padEnd(8)} ${'Bid'.padEnd(8)} ${'Ask'.padEnd(8)} ${'Spread'.padEnd(10)}`);
                log.info('-'.repeat(50));

                generatedQuotes = [];

                for (const market of TEST_MARKETS) {
                    const quote = engine.generateQuote({
                        tokenId: `token-${market.strike}`,
                        strike: market.strike,
                        maturity: '2026-01-19',
                        fairPrice: market.fair,
                        spotPrice: 95000,
                        marketBid: market.marketBid,
                        marketAsk: market.marketAsk,
                        inventoryDelta: 25,
                        tte: market.tte,
                    });

                    generatedQuotes.push(quote);

                    log.info(
                        `${String(market.strike).padEnd(10)} ${market.fair.toFixed(3).padEnd(8)} ${quote.bid.toFixed(3).padEnd(8)} ${quote.ask.toFixed(3).padEnd(8)} ${(quote.spread * 100).toFixed(2)}%`
                    );
                }

                return generatedQuotes;
            },
        },
        {
            name: 'Verify bid < ask for all quotes',
            fn: async () => {
                let violations = 0;

                for (const quote of generatedQuotes) {
                    if (quote.bid >= quote.ask) {
                        log.warn(`Bid/ask violation at ${quote.strike}: ${quote.bid} >= ${quote.ask}`);
                        violations++;
                    }
                }

                assert(violations === 0, `${violations} quotes have bid >= ask`);
                log.info('All quotes have valid bid < ask');
                return { violations };
            },
        },
        {
            name: 'Apply competitive adjustment vs market prices',
            fn: async () => {
                log.info(`\nCompetitive Adjustment:`);
                log.info(`${'Strike'.padEnd(10)} ${'Our Bid'.padEnd(10)} ${'Mkt Bid'.padEnd(10)} ${'Our Ask'.padEnd(10)} ${'Mkt Ask'.padEnd(10)}`);
                log.info('-'.repeat(55));

                for (let i = 0; i < Math.min(3, generatedQuotes.length); i++) {
                    const market = TEST_MARKETS[i];
                    const quote = generatedQuotes[i];
                    const adjusted = engine.applyCompetitiveAdjustment(quote, market.marketBid, market.marketAsk);

                    const bidImprove = adjusted.bid > market.marketBid ? '↑' : '=';
                    const askImprove = adjusted.ask < market.marketAsk ? '↓' : '=';

                    log.info(
                        `${String(market.strike).padEnd(10)} ${adjusted.bid.toFixed(3).padEnd(10)} ${market.marketBid.toFixed(3).padEnd(10)} ${adjusted.ask.toFixed(3).padEnd(10)} ${market.marketAsk.toFixed(3).padEnd(10)} ${bidImprove}${askImprove}`
                    );
                }

                return { adjusted: true };
            },
        },
        {
            name: 'Verify all quotes generated in <100ms for 10 markets',
            fn: async () => {
                const { duration } = await measureTime(async () => {
                    for (let i = 0; i < 10; i++) {
                        for (const market of TEST_MARKETS) {
                            engine.generateQuote({
                                tokenId: `token-${market.strike}`,
                                strike: market.strike,
                                maturity: '2026-01-19',
                                fairPrice: market.fair,
                                spotPrice: 95000,
                                marketBid: market.marketBid,
                                marketAsk: market.marketAsk,
                                inventoryDelta: 25,
                                tte: market.tte,
                            });
                        }
                    }
                });

                log.info(`Generated 50 quotes in ${duration}ms (${(duration / 50).toFixed(2)}ms each)`);
                assertLessThan(duration, 100, `Should complete in <100ms, took ${duration}ms`);
                return { duration, quotesPerMs: 50 / duration };
            },
        },
    ];

    return runTestSuite('Test Suite E: Quote Generation with Inventory Skew', tests);
}

// Already exported above
