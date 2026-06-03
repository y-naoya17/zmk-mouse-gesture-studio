/**
 * ZMKConnection Component
 * A headless component providing connection management UI logic without styling
 */
import React from "react";
import type { UseZMKAppReturn } from "./useZMKApp";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
export interface ZMKConnectionProps {
    /** Optional external ZMK app state. If provided, ZMKConnection won't create its own useZMKApp instance */
    zmkApp?: UseZMKAppReturn;
    /** Render prop for when disconnected */
    renderDisconnected: (props: {
        connect: (connectFunction: () => Promise<RpcTransport>) => Promise<void>;
        isLoading: boolean;
        error: string | null;
    }) => React.ReactNode;
    /** Render prop for when connected */
    renderConnected: (props: {
        disconnect: () => void;
        deviceName: string | undefined;
        subsystems: Array<{
            index: number;
            identifier: string;
        }>;
        findSubsystem: (identifier: string) => {
            index: number;
            identifier: string;
        } | null;
    }) => React.ReactNode;
}
/**
 * Headless connection management component
 * Provides connection state management without any styling
 *
 * - If zmkApp prop is provided, uses that instance (allows parent to manage state)
 * - If zmkApp prop is not provided, creates its own instance internally
 * - Always provides ZMKAppContext to children for easy access via useZMKAppContext
 */
export declare function ZMKConnection({ zmkApp: externalZmkApp, renderDisconnected, renderConnected, }: ZMKConnectionProps): React.JSX.Element;
