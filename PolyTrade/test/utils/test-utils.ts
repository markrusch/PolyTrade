/**
 * Test Utilities for PolyTrade Market Maker
 * 
 * Shared test helpers, assertions, and utilities.
 */

import axios from 'axios';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const TEST_CONFIG = {
    API_URL: process.env.TEST_API_URL || 'http://localhost:3003/api',
    GAMMA_API_URL: 'https://gamma-api.polymarket.com',
    TIMEOUT_MS: 10000,
    PARALLEL_LIMIT: 10,
};

// ═══════════════════════════════════════════════════════════════
// TEST RESULT TYPES
// ═══════════════════════════════════════════════════════════════

export interface TestResult {
    name: string;
    passed: boolean;
    duration: number;
    message?: string;
    data?: any;
}

export interface TestSuiteResult {
    suiteName: string;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    tests: TestResult[];
}

// ═══════════════════════════════════════════════════════════════
// LOGGING UTILITIES
// ═══════════════════════════════════════════════════════════════

export const log = {
    pass: (msg: string) => console.log(`[PASS] ${msg}`),
    fail: (msg: string) => console.log(`[FAIL] ${msg}`),
    info: (msg: string) => console.log(`[INFO] ${msg}`),
    warn: (msg: string) => console.log(`[WARN] ${msg}`),
    section: (title: string) => {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  ${title}`);
        console.log(`${'═'.repeat(60)}\n`);
    },
    subsection: (title: string) => {
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`  ${title}`);
        console.log(`${'─'.repeat(50)}`);
    },
};

// ═══════════════════════════════════════════════════════════════
// TEST RUNNER UTILITIES
// ═══════════════════════════════════════════════════════════════

export async function runTest(
    name: string,
    testFn: () => Promise<any>
): Promise<TestResult> {
    const start = Date.now();
    try {
        const data = await testFn();
        const duration = Date.now() - start;
        log.pass(`${name} (${duration}ms)`);
        return { name, passed: true, duration, data };
    } catch (error: any) {
        const duration = Date.now() - start;
        log.fail(`${name} (${duration}ms) - ${error.message}`);
        return { name, passed: false, duration, message: error.message };
    }
}

export async function runTestSuite(
    suiteName: string,
    tests: Array<{ name: string; fn: () => Promise<any> }>
): Promise<TestSuiteResult> {
    log.section(suiteName);
    const start = Date.now();
    const results: TestResult[] = [];

    for (const test of tests) {
        const result = await runTest(test.name, test.fn);
        results.push(result);
    }

    const duration = Date.now() - start;
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log(`\n  Summary: ${passed}/${results.length} passed in ${duration}ms`);

    return {
        suiteName,
        passed,
        failed,
        skipped: 0,
        duration,
        tests: results,
    };
}

// ═══════════════════════════════════════════════════════════════
// ASSERTIONS
// ═══════════════════════════════════════════════════════════════

export function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
    if (actual !== expected) {
        throw new Error(
            message || `Expected ${expected} but got ${actual}`
        );
    }
}

export function assertGreaterThan(actual: number, min: number, message?: string): void {
    if (actual <= min) {
        throw new Error(
            message || `Expected value > ${min} but got ${actual}`
        );
    }
}

export function assertLessThan(actual: number, max: number, message?: string): void {
    if (actual >= max) {
        throw new Error(
            message || `Expected value < ${max} but got ${actual}`
        );
    }
}

export function assertInRange(actual: number, min: number, max: number, message?: string): void {
    if (actual < min || actual > max) {
        throw new Error(
            message || `Expected value in [${min}, ${max}] but got ${actual}`
        );
    }
}

export function assertArrayLength(arr: any[], minLength: number, message?: string): void {
    if (arr.length < minLength) {
        throw new Error(
            message || `Expected array length >= ${minLength} but got ${arr.length}`
        );
    }
}

export function assertDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
    if (value === undefined || value === null) {
        throw new Error(message || 'Expected value to be defined');
    }
}

// ═══════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════

export async function apiGet<T>(endpoint: string): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${TEST_CONFIG.API_URL}${endpoint}`;
    const response = await axios.get(url, { timeout: TEST_CONFIG.TIMEOUT_MS });
    return response.data;
}

export async function apiPost<T>(endpoint: string, data: any): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${TEST_CONFIG.API_URL}${endpoint}`;
    const response = await axios.post(url, data, { timeout: TEST_CONFIG.TIMEOUT_MS });
    return response.data;
}

// ═══════════════════════════════════════════════════════════════
// TIMING UTILITIES
// ═══════════════════════════════════════════════════════════════

export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration };
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
// PARALLEL EXECUTION
// ═══════════════════════════════════════════════════════════════

export async function runParallel<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    limit: number = TEST_CONFIG.PARALLEL_LIMIT
): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }

    return results;
}

// ═══════════════════════════════════════════════════════════════
// DATA PARSING UTILITIES
// ═══════════════════════════════════════════════════════════════

export function parseStrikeFromSlug(slug: string): number | null {
    // Handle patterns like: bitcoin-above-100k-on-january-19
    const match = slug.match(/above[- ]([\d.]+)k?(?:[- ]|$)/i);
    if (!match) return null;

    let value = parseFloat(match[1]);
    if (slug.match(/above[- ][\d.]+k/i)) {
        value *= 1000;
    }
    return value;
}

export function parseDateFromSlug(slug: string): string | null {
    // Handle patterns like: bitcoin-above-100k-on-january-19
    const monthMap: Record<string, string> = {
        'january': '01', 'february': '02', 'march': '03', 'april': '04',
        'may': '05', 'june': '06', 'july': '07', 'august': '08',
        'september': '09', 'october': '10', 'november': '11', 'december': '12',
    };

    const match = slug.match(/on[- ](\w+)[- ](\d+)/i);
    if (!match) return null;

    const month = monthMap[match[1].toLowerCase()];
    if (!month) return null;

    const day = match[2].padStart(2, '0');
    const year = new Date().getFullYear() + (parseInt(month) < new Date().getMonth() + 1 ? 1 : 0);

    return `${year}-${month}-${day}`;
}

// ═══════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════

export function generateFinalReport(suites: TestSuiteResult[]): void {
    const totalPassed = suites.reduce((sum, s) => sum + s.passed, 0);
    const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0);
    const totalDuration = suites.reduce((sum, s) => sum + s.duration, 0);

    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║              FINAL TEST REPORT                            ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');

    for (const suite of suites) {
        const status = suite.failed === 0 ? '✓' : '✗';
        console.log(`║ ${status} ${suite.suiteName.padEnd(40)} ${suite.passed}/${suite.passed + suite.failed} ║`);
    }

    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║ Total: ${totalPassed}/${totalPassed + totalFailed} tests passed in ${(totalDuration / 1000).toFixed(1)}s`.padEnd(60) + '║');

    if (totalFailed === 0) {
        console.log('║                                                           ║');
        console.log('║          ✅ ALL TESTS PASSED - READY FOR PRODUCTION       ║');
    } else {
        console.log('║                                                           ║');
        console.log(`║          ❌ ${totalFailed} TESTS FAILED - FIX REQUIRED`.padEnd(60) + '║');
    }

    console.log('╚═══════════════════════════════════════════════════════════╝');
}
