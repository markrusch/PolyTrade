/**
 * Retry Handler with Exponential Backoff
 * Provides automatic retry logic with configurable backoff strategy
 */

import { Logger } from '../logger/index.js';

export interface RetryOptions {
  maxAttempts?: number; // Maximum number of retry attempts (default: 5)
  initialDelay?: number; // Initial delay in ms (default: 100)
  maxDelay?: number; // Maximum delay in ms (default: 30000)
  backoffFactor?: number; // Multiplier for exponential backoff (default: 2)
  jitter?: boolean; // Add random jitter to delays (default: true)
  retryableErrors?: (error: any) => boolean; // Predicate to determine if error is retryable
}

export interface RetryState {
  attempt: number;
  lastError: Error | null;
  nextDelay: number;
}

/**
 * Retry handler with exponential backoff and jitter
 */
export class RetryHandler {
  private maxAttempts: number;
  private initialDelay: number;
  private maxDelay: number;
  private backoffFactor: number;
  private jitter: boolean;
  private retryableErrors: (error: any) => boolean;
  protected logger?: Logger;

  constructor(options: RetryOptions = {}, logger?: Logger) {
    this.maxAttempts = options.maxAttempts || 5;
    this.initialDelay = options.initialDelay || 100;
    this.maxDelay = options.maxDelay || 30000;
    this.backoffFactor = options.backoffFactor || 2;
    this.jitter = options.jitter !== undefined ? options.jitter : true;
    this.retryableErrors = options.retryableErrors || this.defaultRetryableErrors;
    this.logger = logger;
  }

  /**
   * Default retryable error predicate
   * Retries on network errors, timeouts, and 5xx server errors
   */
  private defaultRetryableErrors(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNRESET') {
      return true;
    }

    // HTTP 5xx errors
    if (error.response && error.response.status >= 500) {
      return true;
    }

    // Timeout errors
    if (error.message && error.message.includes('timeout')) {
      return true;
    }

    // Rate limit (429) - should retry with backoff
    if (error.response && error.response.status === 429) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay for next retry attempt
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: initialDelay * (backoffFactor ^ attempt)
    let delay = this.initialDelay * Math.pow(this.backoffFactor, attempt);
    
    // Cap at max delay
    delay = Math.min(delay, this.maxDelay);
    
    // Add jitter if enabled (randomize ±25%)
    if (this.jitter) {
      const jitterAmount = delay * 0.25;
      delay = delay + (Math.random() * 2 - 1) * jitterAmount;
    }
    
    return Math.floor(delay);
  }

  /**
   * Execute function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    context?: string
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const result = await fn();
        
        if (attempt > 0 && this.logger) {
          this.logger.info(`Retry succeeded after ${attempt} attempts`, { context });
        }
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if error is retryable
        if (!this.retryableErrors(error)) {
          this.logger?.debug(`Error is not retryable`, { 
            context, 
            error: lastError.message 
          });
          throw lastError;
        }
        
        // Check if we have more attempts left
        const isLastAttempt = attempt === this.maxAttempts - 1;
        if (isLastAttempt) {
          this.logger?.error(`All retry attempts exhausted`, lastError, { 
            context, 
            attempts: this.maxAttempts 
          });
          throw lastError;
        }
        
        // Calculate delay and wait
        const delay = this.calculateDelay(attempt);
        this.logger?.warn(`Retry attempt ${attempt + 1}/${this.maxAttempts} after ${delay}ms`, {
          context,
          error: lastError.message,
        });
        
        await this.sleep(delay);
      }
    }
    
    // Should never reach here, but TypeScript needs it
    throw lastError || new Error('Max retry attempts reached');
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute with retry and return state for each attempt
   */
  async executeWithState<T>(
    fn: () => Promise<T>,
    onAttempt?: (state: RetryState) => void
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const state: RetryState = {
        attempt: attempt + 1,
        lastError,
        nextDelay: this.calculateDelay(attempt),
      };
      
      if (onAttempt) {
        onAttempt(state);
      }
      
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (!this.retryableErrors(error) || attempt === this.maxAttempts - 1) {
          throw lastError;
        }
        
        await this.sleep(state.nextDelay);
      }
    }
    
    throw lastError || new Error('Max retry attempts reached');
  }
}

/**
 * Circuit breaker pattern with retry handler
 * Stops retrying after consecutive failures exceed threshold
 */
export class CircuitBreaker extends RetryHandler {
  private consecutiveFailures: number = 0;
  private failureThreshold: number;
  private resetTimeout: number;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private lastFailureTime: number = 0;

  constructor(options: RetryOptions & { 
    failureThreshold?: number;
    resetTimeout?: number;
  } = {}, logger?: Logger) {
    super(options, logger);
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
  }

  /**
   * Execute with circuit breaker logic
   */
  async execute<T>(fn: () => Promise<T>, context?: string): Promise<T> {
    // Check if circuit is open
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure < this.resetTimeout) {
        throw new Error(`Circuit breaker is OPEN. Retry after ${this.resetTimeout - timeSinceFailure}ms`);
      }
      // Try to close circuit (half-open state)
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await super.execute(fn, context);
      
      // Success - reset circuit
      this.consecutiveFailures = 0;
      this.state = 'CLOSED';
      
      return result;
    } catch (error) {
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();
      
      // Open circuit if threshold exceeded
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.state = 'OPEN';
        this.logger?.error(`Circuit breaker opened after ${this.consecutiveFailures} failures`, error as Error, {
          context,
        });
      }
      
      throw error;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): { state: string; consecutiveFailures: number } {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Manually reset circuit
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = 0;
  }
}

/**
 * Create retry handler
 */
export function createRetryHandler(options?: RetryOptions, logger?: Logger): RetryHandler {
  return new RetryHandler(options, logger);
}

/**
 * Create circuit breaker
 */
export function createCircuitBreaker(
  options?: RetryOptions & { failureThreshold?: number; resetTimeout?: number },
  logger?: Logger
): CircuitBreaker {
  return new CircuitBreaker(options, logger);
}
