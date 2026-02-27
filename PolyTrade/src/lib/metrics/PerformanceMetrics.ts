/**
 * Performance Metrics Collector
 * Tracks latency, success rates, and throughput for Binance/Deribit services per crypto
 */

import { writeFileSync } from 'fs';
import path from 'path';

export interface RequestMetric {
  timestamp: number;
  crypto: string;
  service: 'binance' | 'deribit';
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface CryptoMetrics {
  crypto: string;
  service: 'binance' | 'deribit';
  requestCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  lastUpdateTimestamp: number | null;
  uptimePercent: number;
  recentErrors: string[];
}

export interface PerformanceSnapshot {
  timestamp: string;
  testScenario: string;
  enabledServices: {
    binance: { eth: boolean; btc: boolean };
    deribit: { eth: boolean; btc: boolean };
  };
  metrics: Record<string, CryptoMetrics>;
  summary: {
    totalRequests: number;
    totalSuccess: number;
    totalFailures: number;
    overallSuccessRate: number;
  };
}

export class PerformanceMetrics {
  private metrics: Map<string, RequestMetric[]> = new Map();
  private startTime: number = Date.now();
  private flushInterval: NodeJS.Timeout | null = null;
  private outputPath: string;
  private currentScenario: string = 'default';
  private snapshots: PerformanceSnapshot[] = [];

  constructor(outputPath?: string) {
    this.outputPath = outputPath || path.join(process.cwd(), 'performance-metrics.md');
  }

  /**
   * Record a service request
   */
  recordRequest(
    crypto: string,
    service: 'binance' | 'deribit',
    durationMs: number,
    success: boolean,
    error?: string
  ): void {
    const key = `${service}:${crypto}`;
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    this.metrics.get(key)!.push({
      timestamp: Date.now(),
      crypto,
      service,
      durationMs,
      success,
      error,
    });

    // Keep only last 1000 metrics per key to prevent memory bloat
    const arr = this.metrics.get(key)!;
    if (arr.length > 1000) {
      arr.splice(0, arr.length - 1000);
    }
  }

  /**
   * Get metrics for a specific crypto/service combination
   */
  getMetrics(crypto?: string, service?: 'binance' | 'deribit'): CryptoMetrics[] {
    const results: CryptoMetrics[] = [];

    for (const [key, requests] of this.metrics.entries()) {
      const [svc, crpt] = key.split(':');
      
      if ((crypto && crpt !== crypto) || (service && svc !== service)) {
        continue;
      }

      if (requests.length === 0) {
        continue;
      }

      const successfulRequests = requests.filter(r => r.success);
      const failedRequests = requests.filter(r => !r.success);
      const latencies = requests.map(r => r.durationMs).sort((a, b) => a - b);

      const p95Index = Math.floor(latencies.length * 0.95);
      const p99Index = Math.floor(latencies.length * 0.99);

      const recentErrors = failedRequests
        .slice(-5)
        .map(r => r.error || 'Unknown error')
        .filter((v, i, a) => a.indexOf(v) === i); // Unique errors

      const lastUpdate = requests.length > 0 
        ? requests[requests.length - 1].timestamp 
        : null;

      const uptimeMs = Date.now() - this.startTime;
      const successRate = requests.length > 0 
        ? (successfulRequests.length / requests.length) * 100 
        : 0;
      const uptimePercent = uptimeMs > 0 
        ? (successfulRequests.length / Math.max(1, requests.length)) * 100 
        : 0;

      results.push({
        crypto: crpt,
        service: svc as 'binance' | 'deribit',
        requestCount: requests.length,
        successCount: successfulRequests.length,
        failureCount: failedRequests.length,
        successRate,
        avgLatencyMs: latencies.length > 0 
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
          : 0,
        minLatencyMs: latencies.length > 0 ? latencies[0] : 0,
        maxLatencyMs: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
        p95LatencyMs: latencies.length > 0 ? latencies[p95Index] : 0,
        p99LatencyMs: latencies.length > 0 ? latencies[p99Index] : 0,
        lastUpdateTimestamp: lastUpdate,
        uptimePercent,
        recentErrors,
      });
    }

    return results;
  }

  /**
   * Set current test scenario name
   */
  setScenario(scenario: string): void {
    this.currentScenario = scenario;
  }

  /**
   * Take a snapshot of current metrics
   */
  takeSnapshot(enabledServices: PerformanceSnapshot['enabledServices']): void {
    const allMetrics = this.getMetrics();
    const metricsMap: Record<string, CryptoMetrics> = {};

    for (const m of allMetrics) {
      metricsMap[`${m.service}:${m.crypto}`] = m;
    }

    const totalRequests = allMetrics.reduce((sum, m) => sum + m.requestCount, 0);
    const totalSuccess = allMetrics.reduce((sum, m) => sum + m.successCount, 0);
    const totalFailures = allMetrics.reduce((sum, m) => sum + m.failureCount, 0);

    this.snapshots.push({
      timestamp: new Date().toISOString(),
      testScenario: this.currentScenario,
      enabledServices,
      metrics: metricsMap,
      summary: {
        totalRequests,
        totalSuccess,
        totalFailures,
        overallSuccessRate: totalRequests > 0 ? (totalSuccess / totalRequests) * 100 : 0,
      },
    });
  }

  /**
   * Generate markdown report
   */
  private generateMarkdown(): string {
    const lines: string[] = [];
    
    lines.push('# PolyTrade Performance Metrics');
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Runtime:** ${((Date.now() - this.startTime) / 1000).toFixed(1)}s`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Test Scenarios
    if (this.snapshots.length > 0) {
      lines.push('## Test Scenarios');
      lines.push('');

      for (const snapshot of this.snapshots) {
        lines.push(`### ${snapshot.testScenario}`);
        lines.push('');
        lines.push(`**Timestamp:** ${snapshot.timestamp}`);
        lines.push('');
        lines.push('**Enabled Services:**');
        lines.push(`- Binance: ETH=${snapshot.enabledServices.binance.eth}, BTC=${snapshot.enabledServices.binance.btc}`);
        lines.push(`- Deribit: ETH=${snapshot.enabledServices.deribit.eth}, BTC=${snapshot.enabledServices.deribit.btc}`);
        lines.push('');
        lines.push('**Summary:**');
        lines.push(`- Total Requests: ${snapshot.summary.totalRequests}`);
        lines.push(`- Success: ${snapshot.summary.totalSuccess}`);
        lines.push(`- Failures: ${snapshot.summary.totalFailures}`);
        lines.push(`- Success Rate: ${snapshot.summary.overallSuccessRate.toFixed(2)}%`);
        lines.push('');

        if (Object.keys(snapshot.metrics).length > 0) {
          lines.push('**Metrics by Service:**');
          lines.push('');
          lines.push('| Service | Crypto | Requests | Success Rate | Avg Latency | P95 | P99 | Last Update |');
          lines.push('|---------|--------|----------|--------------|-------------|-----|-----|-------------|');

          for (const [key, metrics] of Object.entries(snapshot.metrics)) {
            const lastUpdate = metrics.lastUpdateTimestamp 
              ? new Date(metrics.lastUpdateTimestamp).toISOString().split('T')[1].split('.')[0]
              : 'Never';

            lines.push(`| ${metrics.service} | ${metrics.crypto} | ${metrics.requestCount} | ${metrics.successRate.toFixed(1)}% | ${metrics.avgLatencyMs.toFixed(0)}ms | ${metrics.p95LatencyMs.toFixed(0)}ms | ${metrics.p99LatencyMs.toFixed(0)}ms | ${lastUpdate} |`);
          }

          lines.push('');
        }

        // Recent errors
        const errorsFound = Object.values(snapshot.metrics).some(m => m.recentErrors.length > 0);
        if (errorsFound) {
          lines.push('**Recent Errors:**');
          lines.push('');
          for (const [key, metrics] of Object.entries(snapshot.metrics)) {
            if (metrics.recentErrors.length > 0) {
              lines.push(`- **${metrics.service}:${metrics.crypto}**: ${metrics.recentErrors.join(', ')}`);
            }
          }
          lines.push('');
        }

        lines.push('---');
        lines.push('');
      }
    }

    // Current metrics
    lines.push('## Current Metrics');
    lines.push('');
    
    const currentMetrics = this.getMetrics();
    if (currentMetrics.length === 0) {
      lines.push('*No metrics collected yet*');
      lines.push('');
    } else {
      lines.push('| Service | Crypto | Requests | Success | Failed | Success Rate | Avg Latency | Min | Max | P95 | P99 |');
      lines.push('|---------|--------|----------|---------|--------|--------------|-------------|-----|-----|-----|-----|');

      for (const m of currentMetrics) {
        lines.push(`| ${m.service} | ${m.crypto} | ${m.requestCount} | ${m.successCount} | ${m.failureCount} | ${m.successRate.toFixed(1)}% | ${m.avgLatencyMs.toFixed(0)}ms | ${m.minLatencyMs.toFixed(0)}ms | ${m.maxLatencyMs.toFixed(0)}ms | ${m.p95LatencyMs.toFixed(0)}ms | ${m.p99LatencyMs.toFixed(0)}ms |`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Flush metrics to file
   */
  flush(): void {
    try {
      const markdown = this.generateMarkdown();
      writeFileSync(this.outputPath, markdown, 'utf-8');
    } catch (err) {
      console.error('[PerformanceMetrics] Failed to flush metrics:', err);
    }
  }

  /**
   * Start auto-flush timer
   */
  startAutoFlush(intervalMs: number = 30000): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(() => this.flush(), intervalMs);
    console.log(`[PerformanceMetrics] Auto-flush started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop auto-flush and do final flush
   */
  stopAutoFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
    console.log('[PerformanceMetrics] Auto-flush stopped, final flush complete');
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.snapshots = [];
    this.startTime = Date.now();
  }
}
