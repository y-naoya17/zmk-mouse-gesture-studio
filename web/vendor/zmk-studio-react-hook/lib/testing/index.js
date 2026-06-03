/**
 * Test Helpers for @cormoran/zmk-studio-react-hook
 *
 * This module provides utilities for testing applications that use the ZMK Studio React hooks.
 * It includes mock factories, test wrappers, and fixtures to simplify testing.
 */
import React from "react";
import { ZMKAppContext } from "../ZMKAppContext";
/**
 * Creates a mock RpcTransport for testing
 * @returns A mock transport with required properties
 */
export function createMockTransport() {
    return {
        label: "test",
        abortController: new AbortController(),
        readable: {},
        writable: {},
    };
}
/**
 * Creates a mock notification reader that can be controlled in tests
 * @param notifications - Array of notifications to emit (optional)
 * @returns A mock reader with controllable notification stream
 */
export function createMockNotificationReader(notifications = []) {
    let index = 0;
    return {
        read: jest.fn().mockImplementation(() => {
            if (index < notifications.length) {
                return Promise.resolve({
                    done: false,
                    value: notifications[index++],
                });
            }
            return new Promise(() => { }); // Never resolves (simulates waiting)
        }),
        releaseLock: jest.fn(),
    };
}
/**
 * Creates a mock RpcConnection for testing
 * @param options - Configuration options for the mock connection
 * @returns A mock RPC connection
 */
export function createMockConnection(options = {}) {
    const { label = "test", notifications = [] } = options;
    return {
        label,
        current_request: 0,
        request_response_readable: {},
        request_writable: {},
        notification_readable: {
            getReader: jest.fn().mockReturnValue(createMockNotificationReader(notifications)),
        },
    };
}
/**
 * Creates a mock device info response for testing
 * @param overrides - Properties to override default values
 * @returns A mock GetDeviceInfoResponse
 */
export function createMockDeviceInfo(overrides = {}) {
    return {
        name: "Test Device",
        serialNumber: new Uint8Array([1, 2, 3, 4]),
        ...overrides,
    };
}
/**
 * Creates a mock custom subsystems list for testing
 * @param subsystems - Array of subsystem identifiers or objects with index and identifier
 * @returns A mock ListCustomSubsystemResponse
 */
export function createMockSubsystems(subsystems = []) {
    return {
        subsystems: subsystems.map((item, index) => typeof item === "string"
            ? { index, identifier: item, uiUrl: [] }
            : { uiUrl: [], ...item }),
    };
}
/**
 * Creates a mock ZMKAppState for testing
 * @param overrides - Properties to override default values
 * @returns A mock ZMKAppState
 */
export function createMockZMKAppState(overrides = {}) {
    return {
        connection: null,
        deviceInfo: null,
        customSubsystems: null,
        isLoading: false,
        error: null,
        ...overrides,
    };
}
/**
 * Creates a mock UseZMKAppReturn for testing
 * @param overrides - Properties to override default values
 * @returns A mock UseZMKAppReturn
 */
export function createMockZMKApp(overrides = {}) {
    const { state: stateOverride, ...restOverrides } = overrides;
    const state = createMockZMKAppState(stateOverride);
    return {
        state,
        connect: jest.fn(),
        disconnect: jest.fn(),
        findSubsystem: jest.fn(),
        isConnected: state.connection !== null,
        onNotification: jest.fn().mockReturnValue(() => { }),
        ...restOverrides,
    };
}
/**
 * Creates a connected mock ZMK app for testing
 * @param options - Configuration options
 * @returns A mock UseZMKAppReturn in connected state
 */
export function createConnectedMockZMKApp(options = {}) {
    const { deviceName = "Test Device", subsystems = [], notifications = [], } = options;
    const connection = createMockConnection({ notifications });
    const deviceInfo = createMockDeviceInfo({ name: deviceName });
    const customSubsystems = createMockSubsystems(subsystems);
    return createMockZMKApp({
        state: {
            connection,
            deviceInfo,
            customSubsystems,
            isLoading: false,
            error: null,
        },
        isConnected: true,
        findSubsystem: (identifier) => {
            const subsystem = customSubsystems.subsystems.find((s) => s.identifier === identifier);
            return subsystem || null;
        },
    });
}
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
export function ZMKAppProvider({ children, value, }) {
    return React.createElement(ZMKAppContext.Provider, { value }, children);
}
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
export function setupZMKMocks() {
    const mockTransport = createMockTransport();
    const mockConnection = createMockConnection();
    // Get the mocked module - dynamic import is necessary in test environment
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zmkClient = require("@zmkfirmware/zmk-studio-ts-client");
    // Reset all mocks
    jest.clearAllMocks();
    /**
     * Configures mocks for a successful connection with device info and subsystems
     */
    function mockSuccessfulConnection(options = {}) {
        const { deviceName = "Test Device", deviceInfo = {}, subsystems = [], notifications = [], } = options;
        const connection = createMockConnection({ notifications });
        const deviceInfoResponse = createMockDeviceInfo({
            name: deviceName,
            ...deviceInfo,
        });
        const subsystemsResponse = createMockSubsystems(subsystems);
        zmkClient.create_rpc_connection.mockReturnValue(connection);
        zmkClient.call_rpc
            .mockResolvedValueOnce({
            core: { getDeviceInfo: deviceInfoResponse },
        })
            .mockResolvedValueOnce({
            custom: { listCustomSubsystems: subsystemsResponse },
        });
        return { connection, deviceInfo: deviceInfoResponse, subsystems: subsystemsResponse };
    }
    /**
     * Configures mocks for a failed connection
     */
    function mockFailedConnection(error = "Connection failed") {
        const errorObj = typeof error === "string" ? new Error(error) : error;
        zmkClient.create_rpc_connection.mockImplementation(() => {
            throw errorObj;
        });
    }
    /**
     * Configures mocks for a successful connection but failed device info retrieval
     */
    function mockFailedDeviceInfo() {
        zmkClient.create_rpc_connection.mockReturnValue(mockConnection);
        zmkClient.call_rpc.mockResolvedValueOnce({
            core: { getDeviceInfo: null },
        });
    }
    return {
        mockTransport,
        mockConnection,
        create_rpc_connection: zmkClient.create_rpc_connection,
        call_rpc: zmkClient.call_rpc,
        mockSuccessfulConnection,
        mockFailedConnection,
        mockFailedDeviceInfo,
    };
}
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
export async function waitForNotification(callback, timeout = 1000) {
    const startTime = Date.now();
    while (callback.mock.calls.length === 0) {
        if (Date.now() - startTime > timeout) {
            throw new Error("Timeout waiting for notification");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
