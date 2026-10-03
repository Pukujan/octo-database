import * as React from "react";
import type { DataMode, OctoApi } from "./adapter";
import { DemoOctoApi } from "./demo";
import { LiveOctoApi } from "./live";

const MODE_KEY = "octo.dataMode";

interface OctoDataContextValue {
  mode: DataMode;
  setMode: (mode: DataMode) => void;
  api: OctoApi;
}

const OctoDataContext = React.createContext<OctoDataContextValue | null>(null);

function readStoredMode(): DataMode {
  if (typeof window === "undefined") return "demo";
  const stored = window.localStorage.getItem(MODE_KEY);
  return stored === "live" ? "live" : "demo";
}

export function OctoDataProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<DataMode>(readStoredMode);

  const demoApi = React.useMemo(() => new DemoOctoApi(), []);
  const liveApi = React.useMemo(() => new LiveOctoApi(), []);
  const api = mode === "live" ? liveApi : demoApi;

  const setMode = React.useCallback((next: DataMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = React.useMemo<OctoDataContextValue>(
    () => ({ mode, setMode, api }),
    [mode, setMode, api],
  );

  return <OctoDataContext.Provider value={value}>{children}</OctoDataContext.Provider>;
}

export function useOctoData(): OctoDataContextValue {
  const context = React.useContext(OctoDataContext);
  if (!context) throw new Error("useOctoData must be used inside <OctoDataProvider>");
  return context;
}
