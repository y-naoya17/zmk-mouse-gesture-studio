/**
 * ZMKAppContext
 * React Context for sharing ZMK app state across components
 */
import { createContext } from "react";
/**
 * Context for ZMK app state
 * Provides connection state and methods to child components
 *
 * @example
 * import { useZMKApp, ZMKAppContext } from "@cormoran/zmk-studio-react-hook";
 *
 * function App() {
 *   const zmkApp = useZMKApp();
 *   return (
 *     <ZMKAppContext.Provider value={zmkApp}>
 *       <ConnectionButton />
 *       <DeviceStatus />
 *     </ZMKAppContext.Provider>
 *   );
 * }
 *
 * function ConnectionButton() {
 *   const zmkApp = useContext(ZMKAppContext);
 *   // ... use ZMK app state
 * }
 */
export const ZMKAppContext = createContext(null);
