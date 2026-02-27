/**
 * Crypto Service Control Test Scenarios
 * Tests per-crypto control of Binance/Deribit services with performance tracking
 */

import fetch from 'node-fetch';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import path from 'path';

const API_URL = 'http://localhost:3003';
const ENV_FILE = path.join(process.cwd(), '.env');
const WAIT_TIME = 15000; // 15 seconds between tests

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(color, prefix, message) {
  console.log(`${colors[color]}${prefix}${colors.reset} ${message}`);
}

// Backup .env file
function backupEnv() {
  const envContent = readFileSync(ENV_FILE, 'utf-8');
  writeFileSync(`${ENV_FILE}.backup`, envContent);
  log('blue', '[BACKUP]', '.env file backed up');
  return envContent;
}

// Restore .env file
function restoreEnv() {
  const backupContent = readFileSync(`${ENV_FILE}.backup`, 'utf-8');
  writeFileSync(ENV_FILE, backupContent);
  log('blue', '[RESTORE]', '.env file restored');
}

// Update .env with scenario config
function updateEnv(config) {
  let envContent = readFileSync(ENV_FILE, 'utf-8');

  // Update Binance flags
  envContent = envContent.replace(/BINANCE_ETH_ENABLED=.*/,`BINANCE_ETH_ENABLED=${config.binance.eth}`);
  envContent = envContent.replace(/BINANCE_BTC_ENABLED=.*/,`BINANCE_BTC_ENABLED=${config.binance.btc}`);

  // Update Deribit flags
  envContent = envContent.replace(/DERIBIT_ETH_ENABLED=.*/,`DERIBIT_ETH_ENABLED=${config.deribit.eth}`);
  envContent = envContent.replace(/DERIBIT_BTC_ENABLED=.*/,`DERIBIT_BTC_ENABLED=${config.deribit.btc}`);

  writeFileSync(ENV_FILE, envContent);
  log('cyan', '[CONFIG]', `Updated .env: Binance(ETH=${config.binance.eth}, BTC=${config.binance.btc}), Deribit(ETH=${config.deribit.eth}, BTC=${config.deribit.btc})`);
}

// Stop services
async function stopServices() {
  try {
    log('yellow', '[STOP]', 'Stopping services...');
    execSync('powershell -File .\\scripts\\stop.ps1', { stdio: 'inherit' });
    await sleep(3000);
  } catch (err) {
    log('red', '[ERROR]', 'Failed to stop services');
  }
}

// Start services
async function startServices() {
  try {
    log('green', '[START]', 'Starting services...');
    execSync('powershell -File .\\scripts\\start.ps1', { stdio: 'pipe' });
    await sleep(12000); // Wait for services to initialize
  } catch (err) {
    log('red', '[ERROR]', 'Failed to start services');
  }
}

// Take metrics snapshot
async function takeSnapshot(scenario, config) {
  try {
    const response = await fetch(`${API_URL}/api/metrics/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario,
        enabledServices: config,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    log('green', '[SNAPSHOT]', `Recorded snapshot for "${scenario}"`);
    return data;
  } catch (err) {
    log('red', '[ERROR]', `Failed to take snapshot: ${err.message}`);
    return null;
  }
}

// Get service status
async function getServiceStatus() {
  try {
    const response = await fetch(`${API_URL}/api/services/status`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    log('cyan', '[STATUS]', `Services: ${data.counts.running} running, ${data.counts.stopped} stopped, ${data.counts.error} errors`);

    for (const service of data.services) {
      const status = service.connected ? '✓' : '✗';
      log('cyan', `  ${status}`, `${service.service}:${service.crypto} - ${service.status}`);
    }

    return data;
  } catch (err) {
    log('red', '[ERROR]', `Failed to get status: ${err.message}`);
    return null;
  }
}

// Get performance metrics
async function getMetrics() {
  try {
    const response = await fetch(`${API_URL}/api/metrics/performance`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    log('cyan', '[METRICS]', `Retrieved metrics for ${data.metrics.length} services`);

    for (const metric of data.metrics) {
      log('cyan', '  📊', `${metric.service}:${metric.crypto} - ${metric.requestCount} requests, ${metric.successRate.toFixed(1)}% success, ${metric.avgLatencyMs.toFixed(0)}ms avg`);
    }

    return data;
  } catch (err) {
    log('red', '[ERROR]', `Failed to get metrics: ${err.message}`);
    return null;
  }
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test scenarios
const scenarios = [
  {
    name: 'Scenario 1: ETH Only',
    config: {
      binance: { eth: 'true', btc: 'false' },
      deribit: { eth: 'true', btc: 'false' },
    },
  },
  {
    name: 'Scenario 2: BTC Only',
    config: {
      binance: { eth: 'false', btc: 'true' },
      deribit: { eth: 'false', btc: 'true' },
    },
  },
  {
    name: 'Scenario 3: Both ETH + BTC',
    config: {
      binance: { eth: 'true', btc: 'true' },
      deribit: { eth: 'true', btc: 'true' },
    },
  },
  {
    name: 'Scenario 4: All Disabled',
    config: {
      binance: { eth: 'false', btc: 'false' },
      deribit: { eth: 'false', btc: 'false' },
    },
  },
];

// Main test execution
async function runTests() {
  console.log('\n' + '='.repeat(70));
  log('blue', '🧪', 'PolyTrade Crypto Service Control Test Suite');
  console.log('='.repeat(70) + '\n');

  const originalEnv = backupEnv();

  try {
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];

      console.log('\n' + '-'.repeat(70));
      log('yellow', `[${i + 1}/${scenarios.length}]`, scenario.name);
      console.log('-'.repeat(70));

      // Update env and restart
      updateEnv(scenario.config);
      await stopServices();
      await startServices();

      // Wait for data collection
      log('cyan', '[WAIT]', `Collecting data for ${WAIT_TIME / 1000}s...`);
      await sleep(WAIT_TIME);

      // Get status and metrics
      await getServiceStatus();
      await getMetrics();

      // Take snapshot
      await takeSnapshot(scenario.name, scenario.config);

      log('green', '[DONE]', `${scenario.name} complete\n`);
    }

    console.log('\n' + '='.repeat(70));
    log('green', '✅', 'All test scenarios completed successfully');
    log('blue', '📄', 'Results saved to: performance-metrics.md');
    console.log('='.repeat(70) + '\n');

  } catch (err) {
    log('red', '[FATAL]', `Test suite failed: ${err.message}`);
  } finally {
    // Restore original .env
    restoreEnv();
    log('yellow', '[CLEANUP]', 'Test complete, .env restored');
  }
}

// Run tests
runTests().catch(err => {
  log('red', '[FATAL]', err.message);
  process.exit(1);
});
