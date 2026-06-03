/**
 * useZMKApp Hook
 * Generic hook for managing ZMK device connection and subsystem discovery
 */
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";
import type { GetDeviceInfoResponse } from "@zmkfirmware/zmk-studio-ts-client/core";
import type { Notification as CoreNotification } from "@zmkfirmware/zmk-studio-ts-client/core";
import type { Notification as KeymapNotification } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { ListCustomSubsystemResponse, CustomNotification } from "@zmkfirmware/zmk-studio-ts-client/custom";
/**
 * Notification subscription types
 */
export type NotificationSubscription = {
    type: "core";
    callback: (notification: CoreNotification) => void;
} | {
    type: "keymap";
    callback: (notification: KeymapNotification) => void;
} | {
    type: "custom";
    subsystemIndex: number;
    callback: (notification: CustomNotification) => void;
};
export interface ZMKAppState {
    /** RPC connection to the device */
    connection: RpcConnection | null;
    /** Device information */
    deviceInfo: GetDeviceInfoResponse | null;
    /** Available custom subsystems */
    customSubsystems: ListCustomSubsystemResponse | null;
    /** Whether the app is currently loading */
    isLoading: boolean;
    /** Any error that occurred */
    error: string | null;
}
export interface UseZMKAppReturn {
    /** Current app state */
    state: ZMKAppState;
    /** Connect to a device */
    connect: (connectFunction: () => Promise<RpcTransport>) => Promise<void>;
    /** Disconnect from the device */
    disconnect: () => void;
    /** Find a specific subsystem by identifier */
    findSubsystem: (identifier: string) => {
        index: number;
        identifier: string;
    } | null;
    /** Whether we're currently connected */
    isConnected: boolean;
    /** Subscribe to notifications */
    onNotification: (subscription: NotificationSubscription) => () => void;
}
/**
 * Hook for managing ZMK application state
 * Handles connection lifecycle, device discovery, and subsystem enumeration
 */
export declare function useZMKApp(): UseZMKAppReturn;
