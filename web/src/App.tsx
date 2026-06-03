import { useCallback, useContext, useMemo, useState } from "react";
import "./App.css";
import { connect as serialConnect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import {
  ZMKAppContext,
  ZMKConnection,
  ZMKCustomSubsystem,
} from "@cormoran/zmk-studio-react-hook";
import { Binding, Config, Direction, Gesture, Request, Response } from "./proto/zmk/mouse_gesture/mouse_gesture";

const SUBSYSTEM_IDENTIFIER = "zmk_mouse_gesture";

const directionLabels: Record<number, string> = {
  [Direction.DIRECTION_UP]: "↑",
  [Direction.DIRECTION_DOWN]: "↓",
  [Direction.DIRECTION_LEFT]: "←",
  [Direction.DIRECTION_RIGHT]: "→",
};

const directionButtons = [
  { label: "↑", value: Direction.DIRECTION_UP },
  { label: "↓", value: Direction.DIRECTION_DOWN },
  { label: "←", value: Direction.DIRECTION_LEFT },
  { label: "→", value: Direction.DIRECTION_RIGHT },
];

function defaultConfig(): Config {
  return {
    strokeSize: 150,
    idleTimeoutMs: 300,
    gestureCooldownMs: 500,
    movementThreshold: 0,
    eagerMode: false,
    alwaysActive: false,
    gestures: [],
  };
}

function defaultBinding(): Binding {
  return { localId: 0, param1: 0, param2: 0 };
}

function defaultGesture(index: number): Gesture {
  return {
    name: `gesture_${index + 1}`,
    pattern: [Direction.DIRECTION_UP],
    bindings: [defaultBinding()],
  };
}

function bindingText(gesture: Gesture): string {
  if (!gesture.bindings.length) return "(no binding)";
  return gesture.bindings
    .map((binding) => `local:${binding.localId} p1:${binding.param1} p2:${binding.param2}`)
    .join(", ");
}

function App() {
  return (
    <div className="app">
      <ZMKConnection
        renderDisconnected={({ connect, isLoading, error }) => (
          <>
            <Header connected={false} onDisconnect={() => {}} />
            <section className="connect-card">
              <h2>Connect</h2>
              <p className="subtitle">Connect to a DYA/ZMK device with custom Studio RPC enabled.</p>
              {error && <p className="error">{error}</p>}
              <button className="button primary" disabled={isLoading} onClick={() => connect(serialConnect)}>
                {isLoading ? "Connecting..." : "Connect Serial"}
              </button>
            </section>
          </>
        )}
        renderConnected={({ disconnect, deviceName }) => (
          <>
            <Header connected deviceName={deviceName} onDisconnect={disconnect} />
            <MouseGestureStudio />
          </>
        )}
      />
    </div>
  );
}

function Header({
  connected,
  deviceName,
  onDisconnect,
}: {
  connected: boolean;
  deviceName?: string;
  onDisconnect: () => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <div className="mouse-icon" />
        <div>
          <h1>Mouse Gesture Studio</h1>
          <p className="subtitle">
            Runtime configuration for kot149/zmk-mouse-gesture via cormoran Studio RPC
          </p>
        </div>
      </div>
      {connected && (
        <button className="status button" onClick={onDisconnect}>
          <span className="dot" />
          Connected{deviceName ? `: ${deviceName}` : ""} — Disconnect
        </button>
      )}
    </header>
  );
}

function MouseGestureStudio() {
  const zmkApp = useContext(ZMKAppContext);
  const [config, setConfig] = useState<Config>(defaultConfig());
  const [savedConfig, setSavedConfig] = useState<Config>(defaultConfig());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subsystem = useMemo(
    () => zmkApp?.findSubsystem(SUBSYSTEM_IDENTIFIER),
    [zmkApp?.state.customSubsystems],
  );

  const callRPC = useCallback(
    async (request: Request): Promise<Response | null> => {
      if (!zmkApp?.state.connection || !subsystem) return null;
      const service = new ZMKCustomSubsystem(zmkApp.state.connection, subsystem.index);
      const payload = Request.encode(request).finish();
      const responsePayload = await service.callRPC(payload);
      return responsePayload ? Response.decode(responsePayload) : null;
    },
    [subsystem, zmkApp?.state.connection],
  );

  const reload = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const response = await callRPC(Request.create({ list: {} }));
      if (response?.error) {
        setError(response.error.message);
      } else if (response?.list?.config) {
        setConfig(response.list.config);
        setSavedConfig(response.list.config);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reload");
    } finally {
      setIsBusy(false);
    }
  }, [callRPC]);

  const save = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const response = await callRPC(Request.create({ save: { config } }));
      if (response?.error) {
        setError(response.error.message);
      } else {
        setSavedConfig(config);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsBusy(false);
    }
  }, [callRPC, config]);

  const reset = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const response = await callRPC(Request.create({ reset: {} }));
      if (response?.error) {
        setError(response.error.message);
      } else if (response?.reset?.config) {
        setConfig(response.reset.config);
        setSavedConfig(response.reset.config);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset");
    } finally {
      setIsBusy(false);
    }
  }, [callRPC]);

  if (!subsystem) {
    return (
      <section className="panel">
        <h2>Subsystem not found</h2>
        <p className="subtitle">Firmware does not expose {SUBSYSTEM_IDENTIFIER}.</p>
      </section>
    );
  }

  const updateConfig = (patch: Partial<Config>) => setConfig({ ...config, ...patch });

  const updateGesture = (index: number, gesture: Gesture) => {
    const gestures = [...config.gestures];
    gestures[index] = gesture;
    updateConfig({ gestures });
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Gestures</h2>
          <div className="toolbar">
            <button className="button" disabled={isBusy} onClick={reload}>
              ↻ Reload
            </button>
            <button className="button danger" disabled={isBusy} onClick={reset}>
              Reset to defaults
            </button>
            <button
              className="button primary"
              disabled={isBusy || config.gestures.length >= 16}
              onClick={() => {
                setConfig({ ...config, gestures: [...config.gestures, defaultGesture(config.gestures.length)] });
                setEditingIndex(config.gestures.length);
              }}
            >
              + Add
            </button>
          </div>
        </div>

        <div className="gesture-list">
          {config.gestures.map((gesture, index) => (
            <div className="gesture-row" key={`${gesture.name}-${index}`}>
              <div>
                <div className="gesture-name">{gesture.name || "(unnamed)"}</div>
                <div className="gesture-id">id {index + 1}</div>
              </div>
              <div className="arrows">
                {gesture.pattern.map((direction) => directionLabels[direction] ?? "?").join("")}
              </div>
              <div className="binding">{bindingText(gesture)}</div>
              <div className="row-actions">
                <button className="button" onClick={() => setEditingIndex(editingIndex === index ? null : index)}>
                  Edit
                </button>
                <button
                  className="button danger"
                  onClick={() =>
                    updateConfig({ gestures: config.gestures.filter((_, gestureIndex) => gestureIndex !== index) })
                  }
                >
                  Delete
                </button>
              </div>
              {editingIndex === index && (
                <GestureEditor gesture={gesture} onChange={(next) => updateGesture(index, next)} />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Settings</h2>
          <div className="toolbar">
            <button className="button" disabled={isBusy} onClick={() => setConfig(savedConfig)}>
              Revert
            </button>
            <button className="button primary" disabled={isBusy} onClick={save}>
              Save
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="settings-grid">
          <NumberField label="Stroke size (px)" value={config.strokeSize} onChange={(strokeSize) => updateConfig({ strokeSize })} />
          <NumberField label="Idle timeout (ms)" value={config.idleTimeoutMs} onChange={(idleTimeoutMs) => updateConfig({ idleTimeoutMs })} />
          <NumberField label="Gesture cooldown (ms)" value={config.gestureCooldownMs} onChange={(gestureCooldownMs) => updateConfig({ gestureCooldownMs })} />
          <NumberField label="Movement threshold" value={config.movementThreshold} onChange={(movementThreshold) => updateConfig({ movementThreshold })} />
        </div>
        <div className="checks">
          <label>
            <input type="checkbox" checked={config.eagerMode} onChange={(event) => updateConfig({ eagerMode: event.target.checked })} /> Eager mode
          </label>
          <label>
            <input type="checkbox" checked={config.alwaysActive} onChange={(event) => updateConfig({ alwaysActive: event.target.checked })} /> Always active
          </label>
        </div>
      </section>
    </>
  );
}

function GestureEditor({ gesture, onChange }: { gesture: Gesture; onChange: (gesture: Gesture) => void }) {
  const binding = gesture.bindings[0] ?? defaultBinding();
  const setBinding = (patch: Partial<Binding>) => onChange({ ...gesture, bindings: [{ ...binding, ...patch }] });

  return (
    <div className="editor">
      <label>
        Name
        <input value={gesture.name} onChange={(event) => onChange({ ...gesture, name: event.target.value })} />
      </label>
      <div>
        <label>Pattern</label>
        <div className="direction-buttons">
          {directionButtons.map((direction) => (
            <button
              className="button"
              key={direction.value}
              disabled={gesture.pattern.length >= 8}
              onClick={() => onChange({ ...gesture, pattern: [...gesture.pattern, direction.value] })}
            >
              {direction.label}
            </button>
          ))}
          <button className="button" onClick={() => onChange({ ...gesture, pattern: gesture.pattern.slice(0, -1) })}>
            Backspace
          </button>
          <button className="button" onClick={() => onChange({ ...gesture, pattern: [] })}>
            Clear
          </button>
        </div>
      </div>
      <div className="settings-grid">
        <NumberField label="Behavior local id" value={binding.localId} onChange={(localId) => setBinding({ localId })} />
        <NumberField label="Param 1" value={binding.param1} onChange={(param1) => setBinding({ param1 })} />
        <NumberField label="Param 2" value={binding.param2} onChange={(param2) => setBinding({ param2 })} />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export default App;
