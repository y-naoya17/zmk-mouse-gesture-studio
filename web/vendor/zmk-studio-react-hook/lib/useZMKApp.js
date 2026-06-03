/**
 * useZMKApp Hook
 * Generic hook for managing ZMK device connection and subsystem discovery
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { create_rpc_connection, call_rpc, } from "@zmkfirmware/zmk-studio-ts-client";
import { withTimeout } from "./utils";
/**
 * Hook for managing ZMK application state
 * Handles connection lifecycle, device discovery, and subsystem enumeration
 */
export function useZMKApp() {
    const [state, setState] = useState({
        connection: null,
        deviceInfo: null,
        customSubsystems: null,
        isLoading: false,
        error: null,
    });
    const abortControllerRef = useRef(null);
    // Consolidated callbacks for official notification types
    const notificationCallbacksRef = useRef({
        core: new Set(),
        keymap: new Set(),
    });
    // Custom notifications need a Map since they're indexed by subsystem
    const customNotificationCallbacksRef = useRef(new Map());
    /**
     * Effect: Listen for incoming notifications from the device
     * Automatically starts/stops when connection changes
     */
    useEffect(() => {
        if (!state.connection)
            return;
        const reader = state.connection.notification_readable.getReader();
        const abortController = new AbortController();
        /**
         * Continuously read notifications from the stream and dispatch to subscribers
         */
        const processNotifications = async () => {
            try {
                while (!abortController.signal.aborted) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    // Dispatch notifications based on type
                    if (value.core) {
                        dispatchNotification("core", value.core);
                    }
                    else if (value.keymap) {
                        dispatchNotification("keymap", value.keymap);
                    }
                    else if (value.custom?.customNotification) {
                        dispatchCustomNotification(value.custom.customNotification);
                    }
                }
            }
            catch (error) {
                // Only log errors if we weren't intentionally aborted
                if (!abortController.signal.aborted) {
                    console.error("Error reading notifications:", error);
                }
            }
            finally {
                reader.releaseLock();
            }
        };
        processNotifications();
        return () => {
            abortController.abort();
        };
    }, [state.connection]);
    /**
     * Dispatch notification to all registered callbacks for a given type
     */
    const dispatchNotification = (type, notification) => {
        notificationCallbacksRef.current[type].forEach((callback) => callback(notification));
    };
    /**
     * Dispatch custom notification to all registered callbacks for a subsystem
     */
    const dispatchCustomNotification = (notification) => {
        const callbacks = customNotificationCallbacksRef.current.get(notification.subsystemIndex);
        if (callbacks) {
            callbacks.forEach((callback) => callback(notification));
        }
    };
    /**
     * Connect to a ZMK device
     * @param connectFunction - Function that creates and returns the transport connection
     */
    const connect = useCallback(async (connectFunction) => {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
        // Create new AbortController for this connection
        abortControllerRef.current = new AbortController();
        try {
            // Step 1: Establish transport and RPC connection
            const transport = await connectFunction();
            const connection = create_rpc_connection(transport, {
                signal: abortControllerRef.current.signal,
            });
            // Step 2: Fetch device information
            const deviceInfo = await fetchDeviceInfo(connection);
            if (!deviceInfo) {
                throw new Error("Failed to get device information");
            }
            // Step 3: Fetch custom subsystems (optional - won't fail connection)
            const customSubsystems = await fetchCustomSubsystems(connection);
            // Step 4: Update state with successful connection
            setState({
                connection,
                deviceInfo,
                customSubsystems,
                isLoading: false,
                error: null,
            });
        }
        catch (error) {
            console.error("Connection failed:", error);
            const errorMessage = error instanceof Error ? error.message : "Unknown connection error";
            setState((prev) => ({
                ...prev,
                isLoading: false,
                error: errorMessage,
            }));
        }
    }, []);
    /**
     * Fetch device information from the connected device
     */
    const fetchDeviceInfo = async (connection) => {
        try {
            const response = await withTimeout(call_rpc(connection, {
                core: { getDeviceInfo: true },
            }));
            return response.core?.getDeviceInfo || null;
        }
        catch (error) {
            console.error("Failed to get device info", error);
            return null;
        }
    };
    /**
     * Fetch available custom subsystems from the device
     */
    const fetchCustomSubsystems = async (connection) => {
        try {
            const response = await withTimeout(call_rpc(connection, {
                custom: { listCustomSubsystems: {} },
            }));
            return response.custom?.listCustomSubsystems || null;
        }
        catch (error) {
            console.error("Failed to get custom subsystems", error);
            return null;
        }
    };
    /**
     * Disconnect from the current device
     * Aborts any ongoing operations and clears all state
     */
    const disconnect = useCallback(() => {
        // Abort any ongoing connection and RPC calls
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        // Clear all notification subscriptions
        notificationCallbacksRef.current.core.clear();
        notificationCallbacksRef.current.keymap.clear();
        customNotificationCallbacksRef.current.clear();
        // Reset state to initial values
        setState({
            connection: null,
            deviceInfo: null,
            customSubsystems: null,
            isLoading: false,
            error: null,
        });
    }, []);
    /**
     * Find a subsystem by its identifier string
     * @param identifier - The unique identifier of the subsystem to find
     * @returns The subsystem with its index and identifier, or null if not found
     */
    const findSubsystem = useCallback((identifier) => {
        if (!state.customSubsystems)
            return null;
        const subsystem = state.customSubsystems.subsystems.find((s) => s.identifier === identifier);
        return subsystem
            ? { index: subsystem.index, identifier: subsystem.identifier }
            : null;
    }, [state.customSubsystems]);
    /**
     * Subscribe to notifications
     * @param subscription - Notification subscription configuration
     * @returns Unsubscribe function to stop receiving notifications
     *
     * @example Core notifications
     * const unsubscribe = onNotification({
     *   type: 'core',
     *   callback: (notification) => {
     *     console.log('Lock state:', notification.lockStateChanged);
     *   }
     * });
     *
     * @example Keymap notifications
     * const unsubscribe = onNotification({
     *   type: 'keymap',
     *   callback: (notification) => {
     *     console.log('Unsaved changes:', notification.unsavedChangesStatusChanged);
     *   }
     * });
     *
     * @example Custom notifications
     * const unsubscribe = onNotification({
     *   type: 'custom',
     *   subsystemIndex: 0,
     *   callback: (notification) => {
     *     console.log('Custom payload:', notification.payload);
     *   }
     * });
     */
    const onNotification = useCallback((subscription) => {
        if (subscription.type === "core") {
            // Subscribe to core notifications
            notificationCallbacksRef.current.core.add(subscription.callback);
            return () => {
                notificationCallbacksRef.current.core.delete(subscription.callback);
            };
        }
        else if (subscription.type === "keymap") {
            // Subscribe to keymap notifications
            notificationCallbacksRef.current.keymap.add(subscription.callback);
            return () => {
                notificationCallbacksRef.current.keymap.delete(subscription.callback);
            };
        }
        else {
            // Subscribe to custom notifications for a specific subsystem
            const { subsystemIndex, callback } = subscription;
            let callbacks = customNotificationCallbacksRef.current.get(subsystemIndex);
            if (!callbacks) {
                callbacks = new Set();
                customNotificationCallbacksRef.current.set(subsystemIndex, callbacks);
            }
            callbacks.add(callback);
            return () => {
                const callbacks = customNotificationCallbacksRef.current.get(subsystemIndex);
                if (callbacks) {
                    callbacks.delete(callback);
                    // Clean up empty sets to prevent memory leaks
                    if (callbacks.size === 0) {
                        customNotificationCallbacksRef.current.delete(subsystemIndex);
                    }
                }
            };
        }
    }, []);
    const isConnected = !!state.connection;
    return {
        state,
        connect,
        disconnect,
        findSubsystem,
        isConnected,
        onNotification,
    };
}
