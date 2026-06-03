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
export async function withTimeout(promise, timeoutMs = 5000, errorMessage = "Operation timed out") {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
}
