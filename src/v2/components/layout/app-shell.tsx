import * as React from "react";
import { Outlet } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { useOctoData } from "@v2/data/provider";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

function DemoBanner() {
  const { mode, setMode } = useOctoData();
  if (mode !== "demo") return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-foreground sm:px-6">
      <FlaskConical className="size-3.5 text-warning" />
      <span className="font-medium">Prototype on demo data.</span>
      <span className="text-muted-foreground">
        Values marked “Demo data” are illustrative fixtures, not production capability. Missing
        quota and telemetry render as honest unavailable states.
      </span>
      <button
        type="button"
        onClick={() => setMode("live")}
        className="ml-auto font-medium text-primary underline-offset-4 hover:underline"
      >
        Connect live API
      </button>
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex min-h-screen flex-col lg:pl-64">
        <Topbar onOpenSidebar={() => setMobileOpen(true)} />
        <DemoBanner />

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 animate-in-slow">
            <Outlet />
          </div>
        </main>

        <footer className="border-t border-border px-4 py-4 text-[11px] text-muted-foreground sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2">
            <span>Octo v2 workspace portal — prototype shell.</span>
            <span>
              Provider and database administration stays in the native provider consoles.
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
