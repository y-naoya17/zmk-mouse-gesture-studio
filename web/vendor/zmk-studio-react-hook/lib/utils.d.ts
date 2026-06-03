/**
 * Utility functions for ZMK Studio React Hook
 */
/**
 * Wraps a promise with a timeout
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds (default: 5000ms)
 * @param errorMessage - Custom error message for timeout (default: "Operation timed out")
 * @returns The result of the promise if it resolves before timeout
 * @throws Error if the promise doesn't resolve within the timeout period
 */
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs?: number, errorMessage?: string): Promise<T>;
