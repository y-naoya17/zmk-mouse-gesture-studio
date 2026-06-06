import { useCallback, useContext, useMemo, useState } from "react";
import "./App.css";
import { connect as serialConnect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import {
  ZMKAppContext,
  ZMKConnection,
  ZMKCustomSubsystem,
} from "@cormoran/zmk-studio-react-hook";
import { ActivationKey, Binding, Config, Request, Response } from "./proto/zmk/mouse_gesture/mouse_gesture";

const SUBSYSTEM_IDENTIFIER = "zmk_mouse_gesture";

function defaultConfig(): Config {
  return {
    strokeSize: 150,
    idleTimeoutMs: 300,
    gestureCooldownMs: 500,
    movementThreshold: 0,
    eagerMode: false,
    alwaysActive: false,
    gestures: [],
    activationKeys: [],
  };
}

function defaultBinding(): Binding {
  return { localId: 0, param1: 0, param2: 0 };
}

function defaultActivationKey(index: number): ActivationKey {
  return {
    name: `key_${index + 1}`,
    position: 0,
    layer: 0,
    tappingTermMs: 200,
    tap: defaultBinding(),
    up: defaultBinding(),
    down: defaultBinding(),
    left: defaultBinding(),
    right: defaultBinding(),
  };
}

function bindingText(binding?: Binding): string {
  if (!binding) return "(unset)";
  if (binding.localId === 0 && binding.param1 === 0 && binding.param2 === 0) return "current key";
  return `local:${binding.localId} p1:${binding.param1} p2:${binding.param2}`;
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

  const updateActivationKey = (index: number, activationKey: ActivationKey) => {
    const activationKeys = [...config.activationKeys];
    activationKeys[index] = activationKey;
    updateConfig({ activationKeys });
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Activation Keys</h2>
          <div className="toolbar">
            <button className="button" disabled={isBusy} onClick={reload}>
              ↻ Reload
            </button>
            <button className="button danger" disabled={isBusy} onClick={reset}>
              Reset to defaults
            </button>
            <button
              className="button primary"
              disabled={isBusy || config.activationKeys.length >= 8}
              onClick={() => {
                setConfig({
                  ...config,
                  activationKeys: [
                    ...config.activationKeys,
                    defaultActivationKey(config.activationKeys.length),
                  ],
                });
                setEditingIndex(config.activationKeys.length);
              }}
            >
              + Add Key
            </button>
          </div>
        </div>

        <div className="gesture-list">
          {config.activationKeys.map((activationKey, index) => (
            <div className="gesture-row activation-row" key={`${activationKey.name}-${index}`}>
              <div>
                <div className="gesture-name">{activationKey.name || "(unnamed)"}</div>
                <div className="gesture-id">
                  pos {activationKey.position} / layer {activationKey.layer}
                </div>
              </div>
              <div className="direction-summary">
                <span>↑ {bindingText(activationKey.up)}</span>
                <span>↓ {bindingText(activationKey.down)}</span>
                <span>← {bindingText(activationKey.left)}</span>
                <span>→ {bindingText(activationKey.right)}</span>
              </div>
              <div className="binding">tap {bindingText(activationKey.tap)}</div>
              <div className="row-actions">
                <button className="button" onClick={() => setEditingIndex(editingIndex === index ? null : index)}>
                  Edit
                </button>
                <button
                  className="button danger"
                  onClick={() =>
                    updateConfig({
                      activationKeys: config.activationKeys.filter(
                        (_, activationIndex) => activationIndex !== index,
                      ),
                    })
                  }
                >
                  Delete
                </button>
              </div>
              {editingIndex === index && (
                <ActivationKeyEditor
                  activationKey={activationKey}
                  onChange={(next) => updateActivationKey(index, next)}
                />
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

function ActivationKeyEditor({
  activationKey,
  onChange,
}: {
  activationKey: ActivationKey;
  onChange: (activationKey: ActivationKey) => void;
}) {
  const updateBinding = (key: "tap" | "up" | "down" | "left" | "right", binding: Binding) => {
    onChange({ ...activationKey, [key]: binding });
  };

  return (
    <div className="editor">
      <label>
        Name
        <input
          value={activationKey.name}
          onChange={(event) => onChange({ ...activationKey, name: event.target.value })}
        />
      </label>
      <div className="settings-grid compact">
        <NumberField
          label="Key position"
          value={activationKey.position}
          onChange={(position) => onChange({ ...activationKey, position })}
        />
        <NumberField
          label="Layer"
          value={activationKey.layer}
          onChange={(layer) => onChange({ ...activationKey, layer })}
        />
        <NumberField
          label="Tapping term (ms)"
          value={activationKey.tappingTermMs}
          onChange={(tappingTermMs) => onChange({ ...activationKey, tappingTermMs })}
        />
      </div>
      <div className="action-grid">
        <BindingEditor
          label="Tap"
          binding={activationKey.tap ?? defaultBinding()}
          onChange={(binding) => updateBinding("tap", binding)}
          emptyLabel="current key"
        />
        <BindingEditor label="↑ Up" binding={activationKey.up ?? defaultBinding()} onChange={(binding) => updateBinding("up", binding)} />
        <BindingEditor label="↓ Down" binding={activationKey.down ?? defaultBinding()} onChange={(binding) => updateBinding("down", binding)} />
        <BindingEditor label="← Left" binding={activationKey.left ?? defaultBinding()} onChange={(binding) => updateBinding("left", binding)} />
        <BindingEditor label="→ Right" binding={activationKey.right ?? defaultBinding()} onChange={(binding) => updateBinding("right", binding)} />
      </div>
    </div>
  );
}

function BindingEditor({
  label,
  binding,
  onChange,
  emptyLabel = "no-op",
}: {
  label: string;
  binding: Binding;
  onChange: (binding: Binding) => void;
  emptyLabel?: string;
}) {
  const setBinding = (patch: Partial<Binding>) => onChange({ ...binding, ...patch });

  return (
    <div className="binding-editor">
      <h3>{label}</h3>
      <p className="binding-hint">0 / 0 / 0 = {emptyLabel}</p>
      <NumberField label="Behavior local id" value={binding.localId} onChange={(localId) => setBinding({ localId })} />
      <NumberField label="Param 1" value={binding.param1} onChange={(param1) => setBinding({ param1 })} />
      <NumberField label="Param 2" value={binding.param2} onChange={(param2) => setBinding({ param2 })} />
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
