/**
 * Test Factories for PolyTrade Market Maker
 * 
 * Provides factory functions for creating mock data following the testing-patterns skill:
 * - getMockX(overrides?: Partial<X>) pattern
 * - Sensible defaults with override capability
 * - Keeps tests DRY and maintainable
 */

// ═══════════════════════════════════════════════════════════════
// MARKET FACTORIES
// ═══════════════════════════════════════════════════════════════

export interface MockMarket {
    slug: string;
    title: string;
    strike: number;
    maturity: string;
    endDate: string;
    clobTokenIds: string[];
    conditionId: string;
    crypto: 'BTC' | 'ETH';
    outcomes: string[];
    active: boolean;
}

export function getMockMarket(overrides?: Partial<MockMarket>): MockMarket {
    const strike = overrides?.strike ?? 95000;
    const date = overrides?.maturity ?? '2026-01-19';
    return {
        slug: `bitcoin-above-${strike / 1000}k-on-january-19`,
        title: `Will BTC be above $${strike.toLocaleString()} on ${date}?`,
        strike,
        maturity: date,
        endDate: `${date}T12:00:00Z`,
        clobTokenIds: [
            '21742633143463906290569050155826241533067272736897614950488156847949938836455', // YES
            '21742633143463906290569050155826241533067272736897614950488156847949938836456', // NO
        ],
        conditionId: '0x1234567890abcdef1234567890abcdef12345678',
        crypto: 'BTC',
        outcomes: ['Yes', 'No'],
        active: true,
        ...overrides,
    };
}

export function getMockMarketLadder(strikes: number[], maturity: string): MockMarket[] {
    return strikes.map(strike => getMockMarket({ strike, maturity }));
}

// ═══════════════════════════════════════════════════════════════
// ORDERBOOK FACTORIES
// ═══════════════════════════════════════════════════════════════

export interface MockOrderBookLevel {
    price: string;
    size: string;
}

export interface MockOrderBook {
    tokenId: string;
    bids: MockOrderBookLevel[];
    asks: MockOrderBookLevel[];
    timestamp: number;
    spread: number;
    mid: number;
}

export function getMockOrderBookLevel(
    price: number,
    size: number
): MockOrderBookLevel {
    return {
        price: price.toFixed(3),
        size: size.toFixed(0),
    };
}

export function getMockOrderBook(overrides?: Partial<MockOrderBook>): MockOrderBook {
    const bids = overrides?.bids ?? [
        getMockOrderBookLevel(0.510, 1000),
        getMockOrderBookLevel(0.505, 2000),
        getMockOrderBookLevel(0.500, 3000),
    ];
    const asks = overrides?.asks ?? [
        getMockOrderBookLevel(0.520, 1500),
        getMockOrderBookLevel(0.525, 2500),
        getMockOrderBookLevel(0.530, 3500),
    ];
    const bestBid = parseFloat(bids[0].price);
    const bestAsk = parseFloat(asks[0].price);

    return {
        tokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455',
        bids,
        asks,
        timestamp: Date.now(),
        spread: ((bestAsk - bestBid) / bestBid) * 100,
        mid: (bestBid + bestAsk) / 2,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════
// POSITION FACTORIES
// ═══════════════════════════════════════════════════════════════

export interface MockPosition {
    clobTokenId: string;
    strike: number;
    maturity: string;
    quantity: number;
    avgEntry: number;
    currentPrice: number;
    pnl: number;
    pnlPercent: number;
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
}

export function getMockPosition(overrides?: Partial<MockPosition>): MockPosition {
    const quantity = overrides?.quantity ?? 100;
    const avgEntry = overrides?.avgEntry ?? 0.50;
    const currentPrice = overrides?.currentPrice ?? 0.52;
    const pnl = (currentPrice - avgEntry) * quantity;
    const pnlPercent = ((currentPrice - avgEntry) / avgEntry) * 100;

    return {
        clobTokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455',
        strike: 95000,
        maturity: '2026-01-19',
        quantity,
        avgEntry,
        currentPrice,
        pnl,
        pnlPercent,
        delta: quantity * 0.39,
        gamma: quantity * -0.0025,
        vega: quantity * 0.02,
        theta: quantity * -0.001,
        ...overrides,
    };
}

export function getMockPortfolio(count: number = 15): MockPosition[] {
    const strikes = [88000, 90000, 92000, 94000, 95000, 96000, 98000, 100000, 102000, 104000];
    const maturities = ['2026-01-19', '2026-01-26', '2026-02-02'];

    return Array.from({ length: count }, (_, i) => {
        const strike = strikes[i % strikes.length];
        const maturity = maturities[i % maturities.length];
        const isLong = Math.random() > 0.4;
        const quantity = (isLong ? 1 : -1) * Math.floor(Math.random() * 100 + 20);

        return getMockPosition({
            strike,
            maturity,
            quantity,
            avgEntry: 0.3 + Math.random() * 0.4,
            currentPrice: 0.3 + Math.random() * 0.4,
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// GREEKS FACTORIES
// ═══════════════════════════════════════════════════════════════

export interface MockGreeks {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
}

export function getMockGreeks(overrides?: Partial<MockGreeks>): MockGreeks {
    return {
        delta: 0.39,
        gamma: -0.0025,
        vega: 0.02,
        theta: -0.001,
        ...overrides,
    };
}

export interface MockPortfolioGreeks extends MockGreeks {
    timestamp: string;
    notional: number;
    numPositions: number;
}

export function getMockPortfolioGreeks(overrides?: Partial<MockPortfolioGreeks>): MockPortfolioGreeks {
    return {
        timestamp: new Date().toISOString(),
        delta: 23.4,
        gamma: -1.2,
        vega: 45.3,
        theta: -2.1,
        notional: 12450,
        numPositions: 15,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════
// TRADE FACTORIES
// ═══════════════════════════════════════════════════════════════

export interface MockTrade {
    id: string;
    clobTokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    timestamp: string;
    pnl?: number;
}

export function getMockTrade(overrides?: Partial<MockTrade>): MockTrade {
    return {
        id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        clobTokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455',
        side: 'BUY',
        price: 0.52,
        size: 50,
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════
// QUOTE FACTORIES
// ═══════════════════════════════════════════════════════════════

export interface MockQuote {
    tokenId: string;
    strike: number;
    fair: number;
    bid: number;
    ask: number;
    spread: number;
    inventorySkew: number;
}

export function getMockQuote(overrides?: Partial<MockQuote>): MockQuote {
    const fair = overrides?.fair ?? 0.512;
    const spread = overrides?.spread ?? 0.02;
    const skew = overrides?.inventorySkew ?? 0;

    return {
        tokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455',
        strike: 95000,
        fair,
        bid: fair - spread / 2 + skew,
        ask: fair + spread / 2 + skew,
        spread,
        inventorySkew: skew,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════
// PRICING FACTORIES
// ═══════════════════════════════════════════════════════════════

export interface MockPricingSnapshot {
    spot: number;
    iv: number;
    strike: number;
    tte: number;
    fairPrice: number;
    probAbove: number;
}

export function getMockPricingSnapshot(overrides?: Partial<MockPricingSnapshot>): MockPricingSnapshot {
    return {
        spot: 95234,
        iv: 58,
        strike: 95000,
        tte: 0.025,
        fairPrice: 0.512,
        probAbove: 0.512,
        ...overrides,
    };
}
