import { ErrorLevel, RetryPolicy } from '../../types';

export enum ErrorCategory {
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  NOT_FOUND = 'not_found',
  RATE_LIMIT = 'rate_limit',
  SERVER = 'server',
  CLIENT = 'client',
  UNKNOWN = 'unknown'
}

export interface ErrorContext {
  pluginId?: string;
  skillId?: string;
  operation?: string;
  timestamp?: Date;
  metadata?: Record<string, any>;
}

export interface FallbackHandler<T> {
  (error: Error, context?: ErrorContext): Promise<T> | T;
}

export class ErrorHandler {
  private fallbackHandlers: Map<string, FallbackHandler<any>>;
  private circuitBreakerState: Map<string, { failures: number; lastFailure: number; isOpen: boolean }>;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000;

  constructor() {
    this.fallbackHandlers = new Map();
    this.circuitBreakerState = new Map();
  }

  categorizeError(error: Error | string): ErrorCategory {
    const errorMessage = typeof error === 'string' ? error.toLowerCase() : error.message.toLowerCase();

    if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('econnrefused')) {
      return ErrorCategory.NETWORK;
    }
    if (errorMessage.includes('timeout') || errorMessage.includes('etimedout')) {
      return ErrorCategory.TIMEOUT;
    }
    if (errorMessage.includes('auth') || errorMessage.includes('token') || errorMessage.includes('credential')) {
      return ErrorCategory.AUTHENTICATION;
    }
    if (errorMessage.includes('permission') || errorMessage.includes('forbidden') || errorMessage.includes('access')) {
      return ErrorCategory.AUTHORIZATION;
    }
    if (errorMessage.includes('validation') || errorMessage.includes('invalid') || errorMessage.includes('schema')) {
      return ErrorCategory.VALIDATION;
    }
    if (errorMessage.includes('not found') || errorMessage.includes('404') || errorMessage.includes('enoent')) {
      return ErrorCategory.NOT_FOUND;
    }
    if (errorMessage.includes('rate limit') || errorMessage.includes('429') || errorMessage.includes('too many')) {
      return ErrorCategory.RATE_LIMIT;
    }
    if (errorMessage.includes('server') || errorMessage.includes('500') || errorMessage.includes('503')) {
      return ErrorCategory.SERVER;
    }
    if (errorMessage.includes('client') || errorMessage.includes('400') || errorMessage.includes('bad request')) {
      return ErrorCategory.CLIENT;
    }

    return ErrorCategory.UNKNOWN;
  }

  getErrorLevel(category: ErrorCategory): ErrorLevel {
    switch (category) {
      case ErrorCategory.NETWORK:
      case ErrorCategory.TIMEOUT:
      case ErrorCategory.SERVER:
        return ErrorLevel.WARNING;
      case ErrorCategory.AUTHENTICATION:
      case ErrorCategory.AUTHORIZATION:
      case ErrorCategory.RATE_LIMIT:
        return ErrorLevel.ERROR;
      case ErrorCategory.VALIDATION:
      case ErrorCategory.NOT_FOUND:
        return ErrorLevel.INFO;
      default:
        return ErrorLevel.ERROR;
    }
  }

  registerFallback(operation: string, handler: FallbackHandler<any>): void {
    this.fallbackHandlers.set(operation, handler);
  }

  async withRetry<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy,
    context?: ErrorContext
  ): Promise<T> {
    let lastError: Error = new Error('Unknown error');
    let hasError = false;
    const maxRetries = policy.maxRetries || 3;
    const initialDelay = policy.initialDelay || 1000;
    const maxDelay = policy.maxDelay || 30000;
    const backoffMultiplier = policy.backoffMultiplier || 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        hasError = true;
        lastError = error instanceof Error ? error : new Error(String(error));
        const category = this.categorizeError(lastError);

        if (policy.retryableErrors && policy.retryableErrors.length > 0) {
          const isRetryable = policy.retryableErrors.some(e => 
            lastError.message.toLowerCase().includes(e.toLowerCase())
          );
          if (!isRetryable) {
            throw lastError;
          }
        }

        if (category === ErrorCategory.AUTHENTICATION || 
            category === ErrorCategory.AUTHORIZATION ||
            category === ErrorCategory.VALIDATION ||
            category === ErrorCategory.NOT_FOUND) {
          throw lastError;
        }

        if (attempt < maxRetries) {
          const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt), maxDelay);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  async withCircuitBreaker<T>(
    operation: () => Promise<T>,
    operationId: string,
    context?: ErrorContext
  ): Promise<T> {
    const state = this.circuitBreakerState.get(operationId) || { failures: 0, lastFailure: 0, isOpen: false };

    if (state.isOpen) {
      if (Date.now() - state.lastFailure > this.CIRCUIT_BREAKER_TIMEOUT) {
        state.isOpen = false;
        state.failures = 0;
      } else {
        throw new Error(`Circuit breaker is open for operation: ${operationId}`);
      }
    }

    try {
      const result = await operation();
      state.failures = 0;
      this.circuitBreakerState.set(operationId, state);
      return result;
    } catch (error) {
      state.failures++;
      state.lastFailure = Date.now();

      if (state.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
        state.isOpen = true;
      }

      this.circuitBreakerState.set(operationId, state);
      throw error;
    }
  }

  async withFallback<T>(
    operation: () => Promise<T>,
    fallback: FallbackHandler<T>,
    context?: ErrorContext
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.warn(`Operation failed, attempting fallback:`, error);
      return await fallback(error instanceof Error ? error : new Error(String(error)), context);
    }
  }

  async withDegradation<T>(
    operation: () => Promise<T>,
    fallback: FallbackHandler<T>,
    context?: ErrorContext
  ): Promise<{ result?: T; degraded: boolean; error?: string }> {
    try {
      const result = await this.withCircuitBreaker(operation, context?.operation || 'default', context);
      return { result, degraded: false };
    } catch (error) {
      console.warn(`Operation failed with circuit breaker, attempting degradation:`, error);
      
      try {
        const degradedResult = await fallback(
          error instanceof Error ? error : new Error(String(error)),
          context
        );
        return { 
          result: degradedResult as T, 
          degraded: true, 
          error: error instanceof Error ? error.message : String(error) 
        };
      } catch (fallbackError) {
        return { 
          degraded: true, 
          error: `Both primary and fallback failed. Primary: ${error instanceof Error ? error.message : String(error)}, Fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}` 
        };
      }
    }
  }

  async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    context?: ErrorContext
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isCircuitBreakerOpen(operationId: string): boolean {
    const state = this.circuitBreakerState.get(operationId);
    if (!state) return false;

    if (state.isOpen) {
      if (Date.now() - state.lastFailure > this.CIRCUIT_BREAKER_TIMEOUT) {
        return false;
      }
      return true;
    }

    return false;
  }

  resetCircuitBreaker(operationId?: string): void {
    if (operationId) {
      this.circuitBreakerState.delete(operationId);
    } else {
      this.circuitBreakerState.clear();
    }
  }

  getCircuitBreakerStatus(operationId: string): { isOpen: boolean; failures: number; lastFailure: number } | null {
    return this.circuitBreakerState.get(operationId) || null;
  }
}

export const errorHandler = new ErrorHandler();
