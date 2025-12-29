/**
 * UNIFIED LOGGING SYSTEM
 * 
 * Centralized logger for console + file output
 * Features:
 * - Structured logging with operation IDs for tracing
 * - Console output with color coding
 * - File output (daily rotation)
 * - Timestamp on all logs
 * - Request/response logging support
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Color codes for console output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

class Logger {
  constructor(module = 'APP') {
    this.module = module;
    this.requestId = null;
  }

  /**
   * Set request ID for tracing
   */
  setRequestId(id) {
    this.requestId = id;
  }

  /**
   * Format timestamp for logs
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Get current log filename (based on date)
   */
  getLogFile() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(LOGS_DIR, `polymarket-${date}.log`);
  }

  /**
   * Write to log file
   */
  writeToFile(level, message, data = null) {
    try {
      const timestamp = this.getTimestamp();
      const requestId = this.requestId ? ` [REQ:${this.requestId}]` : '';
      const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
      const logLine = `[${timestamp}] [${level}] [${this.module}]${requestId} ${message}${dataStr}\n`;

      fs.appendFileSync(this.getLogFile(), logLine);
    } catch (err) {
      console.error('Failed to write to log file:', err.message);
    }
  }

  /**
   * Format console output with color
   */
  formatConsole(level, message, icon = '') {
    const levelUpper = level.toUpperCase();
    const timestamp = this.getTimestamp().split('T')[1].split('Z')[0]; // HH:MM:SS
    const requestId = this.requestId ? ` [${this.requestId}]` : '';

    let color = COLORS.white;
    switch (level) {
      case 'error':
        color = COLORS.red;
        break;
      case 'warn':
        color = COLORS.yellow;
        break;
      case 'success':
        color = COLORS.green;
        break;
      case 'info':
        color = COLORS.blue;
        break;
      case 'debug':
        color = COLORS.dim;
        break;
      default:
        color = COLORS.cyan;
    }

    return `${color}[${timestamp}] [${levelUpper}] [${this.module}]${requestId} ${icon} ${message}${COLORS.reset}`;
  }

  // Public methods
  debug(message, data = null) {
    console.log(this.formatConsole('debug', message, '🔍'));
    this.writeToFile('DEBUG', message, data);
  }

  info(message, data = null) {
    console.log(this.formatConsole('info', message, 'ℹ️'));
    this.writeToFile('INFO', message, data);
  }

  success(message, data = null) {
    console.log(this.formatConsole('success', message, '✅'));
    this.writeToFile('SUCCESS', message, data);
  }

  warn(message, data = null) {
    console.log(this.formatConsole('warn', message, '⚠️'));
    this.writeToFile('WARN', message, data);
  }

  error(message, data = null, err = null) {
    const errorData = err ? { ...data, error: err.message, stack: err.stack } : data;
    console.log(this.formatConsole('error', message, '❌'));
    this.writeToFile('ERROR', message, errorData);
  }

  /**
   * Log API request
   */
  logRequest(method, path, data = null) {
    const msg = `${method} ${path}`;
    console.log(this.formatConsole('info', msg, '📡'));
    this.writeToFile('REQUEST', msg, data);
  }

  /**
   * Log API response
   */
  logResponse(status, message, data = null) {
    const icon = status >= 400 ? '❌' : '✅';
    const msg = `Response [${status}] ${message}`;
    console.log(this.formatConsole('info', msg, icon));
    this.writeToFile('RESPONSE', msg, { status, ...data });
  }

  /**
   * Log operation start
   */
  logStart(operation, details = null) {
    const msg = `Starting: ${operation}`;
    console.log(this.formatConsole('info', msg, '▶️'));
    this.writeToFile('START', msg, details);
  }

  /**
   * Log operation end
   */
  logEnd(operation, details = null) {
    const msg = `Completed: ${operation}`;
    console.log(this.formatConsole('success', msg, '⏹️'));
    this.writeToFile('END', msg, details);
  }

  /**
   * Log critical action (e.g., cancel, killswitch, sell)
   */
  logAction(action, target, result, details = null) {
    const msg = `ACTION [${action}] on ${target}: ${result}`;
    const icon = result === 'SUCCESS' ? '⚡' : '❌';
    console.log(this.formatConsole('info', msg, icon));
    this.writeToFile('ACTION', msg, details);
  }
}

/**
 * Create logger instance with module name
 */
function createLogger(moduleName) {
  return new Logger(moduleName);
}

module.exports = {
  Logger,
  createLogger
};
