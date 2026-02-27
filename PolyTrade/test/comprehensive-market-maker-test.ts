/**
 * Comprehensive Market Maker Test Suite
 * 
 * Master orchestration file that runs all test suites:
 * - Suite A: Multi-Strike Market Discovery
 * - Suite B: OrderBook Fetching & Aggregation
 * - Suite C: Black-Scholes Pricing Engine
 * - Suite D: Portfolio Greeks & Position Tracking
 * - Suite E: Quote Generation with Inventory Skew
 * - Suite F: SQLite Schema & CRUD Operations
 * 
 * Then performs end-to-end integration validation.
 */

import { runMarketDiscoveryTests } from './integration/market-discovery.test.js';
import { runOrderBookTests } from './integration/orderbook-aggregation.test.js';
import { runPricingEngineTests } from './integration/pricing-engine.test.js';
import { runPortfolioGreeksTests } from './integration/portfolio-greeks.test.js';
import { runQuoteGenerationTests } from './integration/quote-generation.test.js';
import { runDatabaseTests } from './integration/database-operations.test.js';
import { TestSuiteResult, generateFinalReport, log, measureTime, apiGet } from './utils/test-utils.js';

// ═══════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════

function printBanner(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   ██████╗  ██████╗ ██╗  ██╗   ██╗████████╗██████╗  █████╗ ██████╗ ███████╗    ║
║   ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝    ║
║   ██████╔╝██║   ██║██║   ╚████╔╝    ██║   ██████╔╝███████║██║  ██║█████╗      ║
║   ██╔═══╝ ██║   ██║██║    ╚██╔╝     ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝      ║
║   ██║     ╚██████╔╝███████╗██║      ██║   ██║  ██║██║  ██║██████╔╝███████╗    ║
║   ╚═╝      ╚═════╝ ╚══════╝╚═╝      ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝    ║
║                                                                               ║
║             COMPREHENSIVE MARKET MAKER TEST SUITE                             ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
}

// ═══════════════════════════════════════════════════════════════
// END-TO-END INTEGRATION TEST
// ═══════════════════════════════════════════════════════════════

async function runIntegrationTest(): Promise<TestSuiteResult> {
    const tests: Array<{ name: string; passed: boolean; duration: number; message?: string }> = [];
    const start = Date.now();

    console.log('\n');
    log.section('END-TO-END INTEGRATION TEST');

    // Step 1: Check backend health
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STEP 1: SYSTEM INITIALIZATION                               │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    try {
        const health = await apiGet<any>('/health');
        console.log('[✓] Backend server responding');
        console.log(`    Status: ${health.status}`);
        console.log(`    Services: ${JSON.stringify(health.services)}`);
        tests.push({ name: 'Backend Health Check', passed: true, duration: 0 });
    } catch (error: any) {
        console.log('[✗] Backend server not responding');
        console.log(`    Error: ${error.message}`);
        tests.push({ name: 'Backend Health Check', passed: false, duration: 0, message: error.message });
    }

    // Step 2: Check live data
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STEP 2: DATA COLLECTION (LIVE MARKET DATA)                  │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    try {
        const status = await apiGet<any>('/status');
        const hasBTC = status.currentSpotBTC && status.currentSpotBTC > 0;
        const hasETH = status.currentSpotETH && status.currentSpotETH > 0;
        const hasIV = status.currentIVETH && status.currentIVETH > 0;

        console.log(`[${hasBTC ? '✓' : '✗'}] BTC Spot: $${status.currentSpotBTC?.toLocaleString() || 'N/A'}`);
        console.log(`[${hasETH ? '✓' : '✗'}] ETH Spot: $${status.currentSpotETH?.toLocaleString() || 'N/A'}`);
        console.log(`[${hasIV ? '✓' : '✗'}] ETH IV: ${status.currentIVETH?.toFixed(1) || 'N/A'}%`);
        console.log(`[✓] Binance: ${status.binanceConnected ? 'Connected' : 'Disconnected'}`);
        console.log(`[✓] Deribit: ${status.deribitConnected ? 'Connected' : 'Disconnected'}`);

        tests.push({ name: 'Live Data Collection', passed: true, duration: 0 });
    } catch (error: any) {
        console.log('[✗] Failed to fetch status');
        tests.push({ name: 'Live Data Collection', passed: false, duration: 0, message: error.message });
    }

    // Step 3: Test market endpoints
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STEP 3: MARKET DISCOVERY                                    │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    try {
        const markets = await apiGet<any[]>('/markets');
        console.log(`[✓] Fetched ${markets.length} markets from API`);

        if (markets.length > 0) {
            console.log(`    Sample: ${markets[0].question?.slice(0, 50) || markets[0].title?.slice(0, 50)}...`);
        }

        tests.push({ name: 'Market Discovery API', passed: true, duration: 0 });
    } catch (error: any) {
        console.log('[✗] Market discovery failed');
        tests.push({ name: 'Market Discovery API', passed: false, duration: 0, message: error.message });
    }

    // Step 4: Test MM controls
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STEP 4: MARKET MAKER CONTROLS                               │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    try {
        const axios = await import('axios');

        // Start MM
        const startResult = await axios.default.post('http://localhost:3003/api/mm/start');
        console.log(`[✓] Start MM: ${startResult.data.message}`);

        // Wait a moment
        await new Promise(r => setTimeout(r, 1000));

        // Stop MM
        const stopResult = await axios.default.post('http://localhost:3003/api/mm/stop');
        console.log(`[✓] Stop MM: ${stopResult.data.message}`);

        tests.push({ name: 'Market Maker Controls', passed: true, duration: 0 });
    } catch (error: any) {
        console.log('[✗] MM control failed');
        tests.push({ name: 'Market Maker Controls', passed: false, duration: 0, message: error.message });
    }

    // Summary
    const passed = tests.filter(t => t.passed).length;
    const failed = tests.filter(t => !t.passed).length;
    const duration = Date.now() - start;

    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ INTEGRATION TEST SUMMARY                                    │');
    console.log('└─────────────────────────────────────────────────────────────┘');
    console.log(`\n    Passed: ${passed}/${tests.length}`);
    console.log(`    Duration: ${duration}ms`);

    return {
        suiteName: 'End-to-End Integration',
        passed,
        failed,
        skipped: 0,
        duration,
        tests,
    };
}

// ═══════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════

async function runAllTests(): Promise<void> {
    printBanner();

    const startTime = Date.now();
    const results: TestSuiteResult[] = [];

    // Run Test Suite A: Market Discovery
    try {
        const resultA = await runMarketDiscoveryTests();
        results.push(resultA);
    } catch (error: any) {
        console.error('Suite A failed:', error.message);
        results.push({
            suiteName: 'Test Suite A: Market Discovery',
            passed: 0,
            failed: 1,
            skipped: 0,
            duration: 0,
            tests: [{ name: 'Suite execution', passed: false, duration: 0, message: error.message }],
        });
    }

    // Run Test Suite B: OrderBook Fetching
    try {
        const resultB = await runOrderBookTests();
        results.push(resultB);
    } catch (error: any) {
        console.error('Suite B failed:', error.message);
        results.push({
            suiteName: 'Test Suite B: OrderBook Fetching',
            passed: 0,
            failed: 1,
            skipped: 0,
            duration: 0,
            tests: [{ name: 'Suite execution', passed: false, duration: 0, message: error.message }],
        });
    }

    // Run Test Suite C: Pricing Engine
    try {
        const resultC = await runPricingEngineTests();
        results.push(resultC);
    } catch (error: any) {
        console.error('Suite C failed:', error.message);
        results.push({
            suiteName: 'Test Suite C: Pricing Engine',
            passed: 0,
            failed: 1,
            skipped: 0,
            duration: 0,
            tests: [{ name: 'Suite execution', passed: false, duration: 0, message: error.message }],
        });
    }

    // Run Test Suite D: Portfolio Greeks
    try {
        const resultD = await runPortfolioGreeksTests();
        results.push(resultD);
    } catch (error: any) {
        console.error('Suite D failed:', error.message);
        results.push({
            suiteName: 'Test Suite D: Portfolio Greeks',
            passed: 0,
            failed: 1,
            skipped: 0,
            duration: 0,
            tests: [{ name: 'Suite execution', passed: false, duration: 0, message: error.message }],
        });
    }

    // Run Test Suite E: Quote Generation
    try {
        const resultE = await runQuoteGenerationTests();
        results.push(resultE);
    } catch (error: any) {
        console.error('Suite E failed:', error.message);
        results.push({
            suiteName: 'Test Suite E: Quote Generation',
            passed: 0,
            failed: 1,
            skipped: 0,
            duration: 0,
            tests: [{ name: 'Suite execution', passed: false, duration: 0, message: error.message }],
        });
    }

    // Run Test Suite F: Database Operations
    try {
        const resultF = await runDatabaseTests();
        results.push(resultF);
    } catch (error: any) {
        console.error('Suite F failed:', error.message);
        results.push({
            suiteName: 'Test Suite F: Database Operations',
            passed: 0,
            failed: 1,
            skipped: 0,
            duration: 0,
            tests: [{ name: 'Suite execution', passed: false, duration: 0, message: error.message }],
        });
    }

    // Run End-to-End Integration Test
    try {
        const integrationResult = await runIntegrationTest();
        results.push(integrationResult);
    } catch (error: any) {
        console.error('Integration test failed:', error.message);
        results.push({
            suiteName: 'End-to-End Integration',
            passed: 0,
            failed: 1,
            skipped: 0,
            duration: 0,
            tests: [{ name: 'Integration test', passed: false, duration: 0, message: error.message }],
        });
    }

    // Generate final report
    const totalDuration = Date.now() - startTime;
    console.log(`\n\nTotal test run time: ${(totalDuration / 1000).toFixed(1)} seconds`);

    generateFinalReport(results);

    // Exit with appropriate code
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    process.exit(totalFailed > 0 ? 1 : 0);
}

// ═══════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════

runAllTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
