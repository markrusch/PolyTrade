/**
 * DataReplayer - Historical Data Replay Framework
 * 
 * Enables backtesting and strategy validation by replaying
 * historical Binance and Deribit data from PolyTrade.db
 * 
 * Features:
 * - Speed control (1x, 10x, 100x replay)
 * - Event emission pattern for live simulation
 * - Time range filtering
 * - Currency/symbol filtering
 */

import { EventEmitter } from 'events';
import { DB, BinanceTick, BinanceSnapshot24h, DeribitSnapshot, DeribitInstrument } from '../../db/Database.js';
import { Logger } from '../logger/index.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface ReplayOptions {
    /** Replay speed multiplier (1 = real-time, 10 = 10x faster) */
    speed: number;
    /** Start time in Unix ms */
    startTime: number;
    /** End time in Unix ms */
    endTime: number;
    /** Batch size for database queries */
    batchSize?: number;
}

export interface BinanceReplayEvent {
    type: 'binance:tick' | 'binance:snapshot';
    data: BinanceTick | BinanceSnapshot24h;
    replayTimestamp: number;
    originalTimestamp: number;
}

export interface DeribitReplayEvent {
    type: 'deribit:snapshot';
    data: DeribitSnapshot;
    instrument?: DeribitInstrument;
    replayTimestamp: number;
    originalTimestamp: number;
}

export interface ReplayProgress {
    current: number;
    total: number;
    percentComplete: number;
    currentTimestamp: number;
    elapsedMs: number;
    estimatedRemainingMs: number;
}

// ============================================================================
// DATA REPLAYER CLASS
// ============================================================================

export class DataReplayer extends EventEmitter {
    private db: DB;
    private logger: Logger;
    private isRunning: boolean = false;
    private isPaused: boolean = false;
    private abortController: AbortController | null = null;

    constructor(db: DB, logger?: Logger) {
        super();
        this.db = db;
        this.logger = logger || new Logger({ level: 'info', service: 'DataReplayer' });
    }

    /**
     * Replay Binance price history for a symbol
     * Emits 'binance:tick' events at controlled speed
     */
    async replayBinancePrices(
        symbol: string,
        options: ReplayOptions,
        callback?: (event: BinanceReplayEvent) => void | Promise<void>
    ): Promise<{ recordsProcessed: number; duration: number }> {
        this.isRunning = true;
        this.isPaused = false;
        this.abortController = new AbortController();

        const { speed, startTime, endTime, batchSize = 1000 } = options;
        const replayStartTime = Date.now();
        let recordsProcessed = 0;
        let lastEventTime = startTime;

        this.logger.info(`Starting Binance replay for ${symbol}`, {
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            speed: `${speed}x`
        });

        try {
            // Fetch data in batches to avoid memory issues
            let currentStart = startTime;
            
            while (currentStart < endTime && !this.abortController.signal.aborted) {
                // Wait if paused
                while (this.isPaused && !this.abortController.signal.aborted) {
                    await this.sleep(100);
                }

                const batch = this.db.getBinancePriceHistory(symbol, currentStart, endTime, batchSize);
                
                if (batch.length === 0) break;

                for (const tick of batch) {
                    if (this.abortController.signal.aborted) break;

                    // Wait if paused
                    while (this.isPaused && !this.abortController.signal.aborted) {
                        await this.sleep(100);
                    }

                    // Calculate delay based on speed
                    const timeDelta = tick.timestamp - lastEventTime;
                    const adjustedDelay = Math.max(0, timeDelta / speed);

                    if (adjustedDelay > 0 && adjustedDelay < 60000) { // Max 1 minute wait
                        await this.sleep(adjustedDelay);
                    }

                    const event: BinanceReplayEvent = {
                        type: 'binance:tick',
                        data: tick,
                        replayTimestamp: Date.now(),
                        originalTimestamp: tick.timestamp
                    };

                    // Emit event
                    this.emit('binance:tick', event);
                    
                    // Call callback if provided
                    if (callback) {
                        await callback(event);
                    }

                    lastEventTime = tick.timestamp;
                    recordsProcessed++;

                    // Emit progress every 100 records
                    if (recordsProcessed % 100 === 0) {
                        this.emitProgress(recordsProcessed, startTime, endTime, tick.timestamp, replayStartTime);
                    }
                }

                // Move to next batch
                currentStart = batch[batch.length - 1].timestamp + 1;
            }
        } finally {
            this.isRunning = false;
            this.abortController = null;
        }

        const duration = Date.now() - replayStartTime;
        this.logger.info(`Binance replay completed`, {
            symbol,
            recordsProcessed,
            durationMs: duration
        });

        this.emit('replay:complete', { type: 'binance', symbol, recordsProcessed, duration });

        return { recordsProcessed, duration };
    }

    /**
     * Replay Deribit IV snapshots for a currency
     * Emits 'deribit:snapshot' events at controlled speed
     */
    async replayDeribitSnapshots(
        currency: string,
        options: ReplayOptions & { expiryAfter?: number },
        callback?: (event: DeribitReplayEvent) => void | Promise<void>
    ): Promise<{ recordsProcessed: number; duration: number }> {
        this.isRunning = true;
        this.isPaused = false;
        this.abortController = new AbortController();

        const { speed, startTime, endTime, batchSize = 1000, expiryAfter } = options;
        const replayStartTime = Date.now();
        let recordsProcessed = 0;
        let lastEventTime = startTime;

        // Cache instruments for enrichment
        const instruments = this.db.getDeribitInstruments(currency, false);
        const instrumentMap = new Map(instruments.map(i => [i.instrumentName, i]));

        this.logger.info(`Starting Deribit replay for ${currency}`, {
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            speed: `${speed}x`,
            instrumentsCached: instruments.length
        });

        try {
            let currentStart = startTime;

            while (currentStart < endTime && !this.abortController.signal.aborted) {
                // Wait if paused
                while (this.isPaused && !this.abortController.signal.aborted) {
                    await this.sleep(100);
                }

                const batch = this.db.getDeribitSnapshotsByCurrency(
                    currency, 
                    currentStart, 
                    endTime, 
                    expiryAfter,
                    batchSize
                );

                if (batch.length === 0) break;

                for (const snapshot of batch) {
                    if (this.abortController.signal.aborted) break;

                    // Wait if paused
                    while (this.isPaused && !this.abortController.signal.aborted) {
                        await this.sleep(100);
                    }

                    // Calculate delay based on speed
                    const timeDelta = snapshot.timestamp - lastEventTime;
                    const adjustedDelay = Math.max(0, timeDelta / speed);

                    if (adjustedDelay > 0 && adjustedDelay < 60000) {
                        await this.sleep(adjustedDelay);
                    }

                    const event: DeribitReplayEvent = {
                        type: 'deribit:snapshot',
                        data: snapshot,
                        instrument: instrumentMap.get(snapshot.instrumentName),
                        replayTimestamp: Date.now(),
                        originalTimestamp: snapshot.timestamp
                    };

                    // Emit event
                    this.emit('deribit:snapshot', event);

                    // Call callback if provided
                    if (callback) {
                        await callback(event);
                    }

                    lastEventTime = snapshot.timestamp;
                    recordsProcessed++;

                    // Emit progress every 100 records
                    if (recordsProcessed % 100 === 0) {
                        this.emitProgress(recordsProcessed, startTime, endTime, snapshot.timestamp, replayStartTime);
                    }
                }

                // Move to next batch
                currentStart = batch[batch.length - 1].timestamp + 1;
            }
        } finally {
            this.isRunning = false;
            this.abortController = null;
        }

        const duration = Date.now() - replayStartTime;
        this.logger.info(`Deribit replay completed`, {
            currency,
            recordsProcessed,
            durationMs: duration
        });

        this.emit('replay:complete', { type: 'deribit', currency, recordsProcessed, duration });

        return { recordsProcessed, duration };
    }

    /**
     * Replay both Binance and Deribit data in synchronized order
     * Useful for strategy backtesting that needs both spot and IV
     */
    async replaySynchronized(
        binanceSymbol: string,
        deribitCurrency: string,
        options: ReplayOptions,
        callback?: (event: BinanceReplayEvent | DeribitReplayEvent) => void | Promise<void>
    ): Promise<{ binanceRecords: number; deribitRecords: number; duration: number }> {
        this.isRunning = true;
        this.isPaused = false;
        this.abortController = new AbortController();

        const { speed, startTime, endTime, batchSize = 500 } = options;
        const replayStartTime = Date.now();
        let binanceRecords = 0;
        let deribitRecords = 0;

        // Cache instruments for enrichment
        const instruments = this.db.getDeribitInstruments(deribitCurrency, false);
        const instrumentMap = new Map(instruments.map(i => [i.instrumentName, i]));

        this.logger.info(`Starting synchronized replay`, {
            binanceSymbol,
            deribitCurrency,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            speed: `${speed}x`
        });

        try {
            // Fetch all data and merge by timestamp
            const binanceData = this.db.getBinancePriceHistory(binanceSymbol, startTime, endTime, 50000);
            const deribitData = this.db.getDeribitSnapshotsByCurrency(deribitCurrency, startTime, endTime, undefined, 50000);

            // Merge and sort by timestamp
            const merged: Array<{ type: 'binance' | 'deribit'; timestamp: number; data: BinanceTick | DeribitSnapshot }> = [
                ...binanceData.map(d => ({ type: 'binance' as const, timestamp: d.timestamp, data: d })),
                ...deribitData.map(d => ({ type: 'deribit' as const, timestamp: d.timestamp, data: d }))
            ].sort((a, b) => a.timestamp - b.timestamp);

            let lastEventTime = startTime;

            for (const item of merged) {
                if (this.abortController.signal.aborted) break;

                // Wait if paused
                while (this.isPaused && !this.abortController.signal.aborted) {
                    await this.sleep(100);
                }

                // Calculate delay based on speed
                const timeDelta = item.timestamp - lastEventTime;
                const adjustedDelay = Math.max(0, timeDelta / speed);

                if (adjustedDelay > 0 && adjustedDelay < 60000) {
                    await this.sleep(adjustedDelay);
                }

                if (item.type === 'binance') {
                    const event: BinanceReplayEvent = {
                        type: 'binance:tick',
                        data: item.data as BinanceTick,
                        replayTimestamp: Date.now(),
                        originalTimestamp: item.timestamp
                    };
                    this.emit('binance:tick', event);
                    if (callback) await callback(event);
                    binanceRecords++;
                } else {
                    const snapshot = item.data as DeribitSnapshot;
                    const event: DeribitReplayEvent = {
                        type: 'deribit:snapshot',
                        data: snapshot,
                        instrument: instrumentMap.get(snapshot.instrumentName),
                        replayTimestamp: Date.now(),
                        originalTimestamp: item.timestamp
                    };
                    this.emit('deribit:snapshot', event);
                    if (callback) await callback(event);
                    deribitRecords++;
                }

                lastEventTime = item.timestamp;

                // Emit progress
                const totalProcessed = binanceRecords + deribitRecords;
                if (totalProcessed % 100 === 0) {
                    this.emitProgress(totalProcessed, startTime, endTime, item.timestamp, replayStartTime);
                }
            }
        } finally {
            this.isRunning = false;
            this.abortController = null;
        }

        const duration = Date.now() - replayStartTime;
        this.logger.info(`Synchronized replay completed`, {
            binanceRecords,
            deribitRecords,
            durationMs: duration
        });

        this.emit('replay:complete', { 
            type: 'synchronized', 
            binanceRecords, 
            deribitRecords, 
            duration 
        });

        return { binanceRecords, deribitRecords, duration };
    }

    /**
     * Pause replay
     */
    pause(): void {
        if (this.isRunning && !this.isPaused) {
            this.isPaused = true;
            this.emit('replay:paused');
            this.logger.info('Replay paused');
        }
    }

    /**
     * Resume replay
     */
    resume(): void {
        if (this.isRunning && this.isPaused) {
            this.isPaused = false;
            this.emit('replay:resumed');
            this.logger.info('Replay resumed');
        }
    }

    /**
     * Stop replay
     */
    stop(): void {
        if (this.isRunning && this.abortController) {
            this.abortController.abort();
            this.emit('replay:stopped');
            this.logger.info('Replay stopped');
        }
    }

    /**
     * Check if replay is running
     */
    get running(): boolean {
        return this.isRunning;
    }

    /**
     * Check if replay is paused
     */
    get paused(): boolean {
        return this.isPaused;
    }

    /**
     * Get available data range for a symbol
     */
    getDataRange(type: 'binance' | 'deribit', symbolOrCurrency: string): { minTimestamp: number; maxTimestamp: number; count: number } | null {
        if (type === 'binance') {
            const result = this.db['db'].prepare(`
                SELECT MIN(timestamp) as minTs, MAX(timestamp) as maxTs, COUNT(*) as cnt
                FROM binance_ticks WHERE symbol = ?
            `).get(symbolOrCurrency) as { minTs: number | null; maxTs: number | null; cnt: number };

            if (!result.minTs) return null;
            return { minTimestamp: result.minTs, maxTimestamp: result.maxTs!, count: result.cnt };
        } else {
            const result = this.db['db'].prepare(`
                SELECT MIN(s.timestamp) as minTs, MAX(s.timestamp) as maxTs, COUNT(*) as cnt
                FROM deribit_snapshots s
                JOIN deribit_instruments i ON s.instrument_name = i.instrument_name
                WHERE i.currency = ?
            `).get(symbolOrCurrency) as { minTs: number | null; maxTs: number | null; cnt: number };

            if (!result.minTs) return null;
            return { minTimestamp: result.minTs, maxTimestamp: result.maxTs!, count: result.cnt };
        }
    }

    // ========================================================================
    // PRIVATE HELPERS
    // ========================================================================

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private emitProgress(
        current: number,
        startTime: number,
        endTime: number,
        currentTimestamp: number,
        replayStartTime: number
    ): void {
        const timeRange = endTime - startTime;
        const timeCovered = currentTimestamp - startTime;
        const percentComplete = (timeCovered / timeRange) * 100;
        const elapsedMs = Date.now() - replayStartTime;
        const estimatedRemainingMs = (elapsedMs / percentComplete) * (100 - percentComplete);

        const progress: ReplayProgress = {
            current,
            total: 0, // Unknown without additional query
            percentComplete: Math.min(100, Math.max(0, percentComplete)),
            currentTimestamp,
            elapsedMs,
            estimatedRemainingMs: isFinite(estimatedRemainingMs) ? estimatedRemainingMs : 0
        };

        this.emit('replay:progress', progress);
    }
}

export default DataReplayer;
