/**
 * ZMK Service
 * Generic service for RPC communication with ZMK custom subsystems
 */
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";
/**
 * Service class for communicating with ZMK custom subsystems via RPC
 *
 * This class provides a simple interface for making RPC calls to custom
 * subsystems on a connected ZMK device. Each subsystem has a unique index
 * and can process custom protobuf payloads.
 *
 * @example
 * const service = new ZMKCustomSubsystem(connection, subsystemIndex);
 * const payload = new Uint8Array([1, 2, 3]); // Your protobuf payload
 * const response = await service.callRPC(payload);
 */
export declare class ZMKCustomSubsystem {
    private connection;
    private subsystemIndex;
    /**
     * Create a new subsystem service instance
     * @param connection - Active RPC connection to the device
     * @param subsystemIndex - Index of the subsystem to communicate with
     */
    constructor(connection: RpcConnection, subsystemIndex: number);
    /**
     * Send an RPC request to this subsystem
     * @param payload - Serialized protobuf payload to send
     * @param options - Optional configuration
     * @param options.timeout - Timeout in milliseconds (default: 5000ms)
     * @returns The response payload from the device, or null if no response
     * @throws Error if the RPC call fails or times out
     */
    callRPC(payload: Uint8Array, options?: {
        timeout?: number;
    }): Promise<Uint8Array | null>;
    /**
     * Check if the subsystem is ready to receive RPC calls
     * @returns true if the connection is active
     */
    isReady(): boolean;
    /**
     * Get the index of this subsystem
     * @returns The subsystem index
     */
    getSubsystemIndex(): number;
    /**
     * Get the underlying RPC connection
     * @returns The RPC connection object
     */
    getConnection(): RpcConnection;
}
/**
 * Error types for ZMK service operations
 */
export declare class ZMKCustomSubsystemError extends Error {
    type: "connection" | "rpc" | "validation";
    code?: number;
    constructor(type: "connection" | "rpc" | "validation", message: string, code?: number);
}
