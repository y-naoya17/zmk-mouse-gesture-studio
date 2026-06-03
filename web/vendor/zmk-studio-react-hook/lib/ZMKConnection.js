/**
 * ZMKConnection Component
 * A headless component providing connection management UI logic without styling
 */
import React from "react";
import { useZMKApp } from "./useZMKApp";
import { ZMKAppContext } from "./ZMKAppContext";
/**
 * Headless connection management component
 * Provides connection state management without any styling
 *
 * - If zmkApp prop is provided, uses that instance (allows parent to manage state)
 * - If zmkApp prop is not provided, creates its own instance internally
 * - Always provides ZMKAppContext to children for easy access via useZMKAppContext
 */
export function ZMKConnection({ zmkApp: externalZmkApp, renderDisconnected, renderConnected, }) {
    // Always call useZMKApp unconditionally (React hooks rule)
    const internalZmkApp = useZMKApp();
    // Use external zmkApp if provided, otherwise use internal instance
    const zmkApp = externalZmkApp ?? internalZmkApp;
    const { state, connect, disconnect, isConnected, findSubsystem } = zmkApp;
    const handleConnect = async (connectFunction) => {
        await connect(connectFunction);
    };
    // Prepare render content
    let content;
    // Disconnected state: show connection UI
    if (!isConnected) {
        content = renderDisconnected({
            connect: handleConnect,
            isLoading: state.isLoading,
            error: state.error,
        });
    }
    else {
        // Connected state: show device management UI
        const subsystems = state.customSubsystems?.subsystems.map((s) => ({
            index: s.index,
            identifier: s.identifier,
        })) ?? [];
        content = renderConnected({
            disconnect,
            deviceName: state.deviceInfo?.name,
            subsystems,
            findSubsystem,
        });
    }
    // Provide context to children
    return (React.createElement(ZMKAppContext.Provider, { value: zmkApp }, content));
}
