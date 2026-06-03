/**
 * ZMK Service
 * Generic service for RPC communication with ZMK custom subsystems
 */
import { call_rpc } from "@zmkfirmware/zmk-studio-ts-client";
import { withTimeout } from "./utils";
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
export class ZMKCustomSubsystem {
    connection;
    subsystemIndex;
    /**
     * Create a new subsystem service instance
     * @param connection - Active RPC connection to the device
     * @param subsystemIndex - Index of the subsystem to communicate with
     */
    constructor(connection, subsystemIndex) {
        this.connection = connection;
        this.subsystemIndex = subsystemIndex;
    }
    /**
     * Send an RPC request to this subsystem
     * @param payload - Serialized protobuf payload to send
     * @param options - Optional configuration
     * @param options.timeout - Timeout in milliseconds (default: 5000ms)
     * @returns The response payload from the device, or null if no response
     * @throws Error if the RPC call fails or times out
     */
    async callRPC(payload, options) {
        const timeout = options?.timeout ?? 5000;
        const response = await withTimeout(call_rpc(this.connection, {
            custom: {
                call: {
                    subsystemIndex: this.subsystemIndex,
                    payload,
                },
            },
        }), timeout);
        return response.custom?.call?.payload || null;
    }
    /**
     * Check if the subsystem is ready to receive RPC calls
     * @returns true if the connection is active
     */
    isReady() {
        return !!this.connection;
    }
    /**
     * Get the index of this subsystem
     * @returns The subsystem index
     */
    getSubsystemIndex() {
        return this.subsystemIndex;
    }
    /**
     * Get the underlying RPC connection
     * @returns The RPC connection object
     */
    getConnection() {
        return this.connection;
    }
}
/**
 * Error types for ZMK service operations
 */
export class ZMKCustomSubsystemError extends Error {
    type;
    code;
    constructor(type, message, code) {
        super(message);
        this.name = "ZMKCustomSubsystemError";
        this.type = type;
        this.code = code;
    }
}
