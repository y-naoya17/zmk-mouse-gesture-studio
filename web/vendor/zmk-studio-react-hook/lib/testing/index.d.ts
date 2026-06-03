/**
 * Test Helpers for @cormoran/zmk-studio-react-hook
 *
 * This module provides utilities for testing applications that use the ZMK Studio React hooks.
 * It includes mock factories, test wrappers, and fixtures to simplify testing.
 */
import React from "react";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";
import type { GetDeviceInfoResponse } from "@zmkfirmware/zmk-studio-ts-client/core";
import type { ListCustomSubsystemResponse } from "@zmkfirmware/zmk-studio-ts-client/custom";
import type { UseZMKAppReturn, ZMKAppState } from "../useZMKApp";
/**
 * Creates a mock RpcTransport for testing
 * @returns A mock transport with required properties
 */
export declare function createMockTransport(): RpcTransport;
/**
 * Creates a mock notification reader that can be controlled in tests
 * @param notifications - Array of notifications to emit (optional)
 * @returns A mock reader with controllable notification stream
 */
export declare function createMockNotificationReader(notifications?: unknown[]): {
    read: jest.Mock<any, any, any>;
    releaseLock: jest.Mock<any, any, any>;
};
/**
 * Creates a mock RpcConnection for testing
 * @param options - Configuration options for the mock connection
 * @returns A mock RPC connection
 */
export declare function createMockConnection(options?: {
    label?: string;
    notifications?: unknown[];
}): RpcConnection;
/**
 * Creates a mock device info response for testing
 * @param overrides - Properties to override default values
 * @returns A mock GetDeviceInfoResponse
 */
export declare function createMockDeviceInfo(overrides?: Partial<GetDeviceInfoResponse>): GetDeviceInfoResponse;
/**
 * Creates a mock custom subsystems list for testing
 * @param subsystems - Array of subsystem identifiers or objects with index and identifier
 * @returns A mock ListCustomSubsystemResponse
 */
export declare function createMockSubsystems(subsystems?: (string | {
    index: number;
    identifier: string;
    uiUrl?: string[];
})[]): ListCustomSubsystemResponse;
/**
 * Creates a mock ZMKAppState for testing
 * @param overrides - Properties to override default values
 * @returns A mock ZMKAppState
 */
export declare function createMockZMKAppState(overrides?: Partial<ZMKAppState>): ZMKAppState;
/**
 * Creates a mock UseZMKAppReturn for testing
 * @param overrides - Properties to override default values
 * @returns A mock UseZMKAppReturn
 */
export declare function createMockZMKApp(overrides?: Partial<UseZMKAppReturn>): UseZMKAppReturn;
/**
 * Creates a connected mock ZMK app for testing
 * @param options - Configuration options
 * @returns A mock UseZMKAppReturn in connected state
 */
export declare function createConnectedMockZMKApp(options?: {
    deviceName?: string;
    subsystems?: string[];
    notifications?: unknown[];
}): UseZMKAppReturn;
/**
 * Test wrapper component that provides ZMKAppContext
 * Useful for testing components that consume the ZMK app context
 *
 * @example
 * ```tsx
 * import { render } from '@testing-library/react';
 * import { ZMKAppProvider, createMockZMKApp } from '@cormoran/zmk-studio-react-hook/testing';
 *
 * const mockZMKApp = createMockZMKApp({ isConnected: true });
 * render(
 *   <ZMKAppProvider value={mockZMKApp}>
 *     <YourComponent />
 *   </ZMKAppProvider>
 * );
 * ```
 */
export declare function ZMKAppProvider({ children, value, }: {
    children: React.ReactNode;
    value: UseZMKAppReturn | null;
}): React.ReactElement;
/**
 * Sets up common mocks for @zmkfirmware/zmk-studio-ts-client
 * This should be called in beforeEach() in your test files
 *
 * @returns An object with mock functions and helper methods
 *
 * @example
 * ```typescript
 * import { setupZMKMocks } from '@cormoran/zmk-studio-react-hook/testing';
 *
 * describe('My Component', () => {
 *   let mocks: ReturnType<typeof setupZMKMocks>;
 *
 *   beforeEach(() => {
 *     mocks = setupZMKMocks();
 *   });
 *
 *   it('should connect', async () => {
 *     mocks.mockSuccessfulConnection({
 *       deviceName: 'My Device',
 *       subsystems: ['test-subsystem'],
 *     });
 *     // ... your test code
 *   });
 * });
 * ```
 */
export declare function setupZMKMocks(): {
    mockTransport: RpcTransport;
    mockConnection: RpcConnection;
    create_rpc_connection: any;
    call_rpc: any;
    mockSuccessfulConnection: (options?: {
        deviceName?: string;
        deviceInfo?: Partial<GetDeviceInfoResponse>;
        subsystems?: string[];
        notifications?: unknown[];
    }) => {
        connection: RpcConnection;
        deviceInfo: GetDeviceInfoResponse;
        subsystems: ListCustomSubsystemResponse;
    };
    mockFailedConnection: (error?: Error | string) => void;
    mockFailedDeviceInfo: () => void;
};
/**
 * Utility to wait for a notification callback to be called
 * Useful in tests that verify notification handling
 *
 * @param callback - The jest mock function to wait for
 * @param timeout - Maximum time to wait in milliseconds (default: 1000)
 * @returns A promise that resolves when the callback is called or rejects on timeout
 *
 * @example
 * ```typescript
 * const notificationCallback = jest.fn();
 * const unsubscribe = zmkApp.onNotification({
 *   type: 'custom',
 *   subsystemIndex: 0,
 *   callback: notificationCallback,
 * });
 *
 * await waitForNotification(notificationCallback);
 * expect(notificationCallback).toHaveBeenCalled();
 * ```
 */
export declare function waitForNotification(callback: jest.Mock, timeout?: number): Promise<void>;
