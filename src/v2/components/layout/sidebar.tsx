import { NavLink } from "react-router-dom";
import {
  Activity,
  Boxes,
  Files,
  HardDrive,
  Images,
  KeyRound,
  LayoutDashboard,
  Server,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@v2/components/ui/badge";
import { Button } from "@v2/components/ui/button";
import { Separator } from "@v2/components/ui/separator";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import { useHealth } from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";
import { cn } from "@v2/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const WORKSPACE_NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/storage", label: "Storage", icon: HardDrive },
  { to: "/files", label: "Files", icon: Files },
  { to: "/gallery", label: "Gallery", icon: Images },
  { to: "/operations", label: "Operations", icon: Activity },
  { to: "/access", label: "Access", icon: KeyRound },
];

const PLATFORM_NAV: NavItem[] = [{ to: "/fleet", label: "Fleet", icon: Server }];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
        <svg viewBox="0 0 64 64" className="size-5" aria-hidden="true">
          <path
            d="M32 14c-10 0-18 7-18 16 0 6 3 10 9 13l-4 11 10-6h6l10 6-4-11c6-3 9-7 9-13 0-9-8-16-18-16Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinejoin="round"
            className="text-primary"
          />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight">Octo</span>
        <span className="text-[11px] text-muted-foreground">Workspace control plane</span>
      </span>
    </div>
  );
}

function NavSection({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/12 text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const { data, isError } = useHealth();
  const { mode } = useOctoData();

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Service status
        </span>
        {mode === "demo" ? (
          <Badge variant="warning">Demo data</Badge>
        ) : isError ? (
          <Badge variant="destructive">Unreachable</Badge>
        ) : (
          <Badge variant="success">Reachable</Badge>
        )}
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <span className="flex items-center justify-between">
          PostgreSQL
          <span className={data?.database.connected ? "text-success" : "text-muted-foreground"}>
            {data?.database.connected ? "connected" : "unknown"}
          </span>
        </span>
        <span className="flex items-center justify-between">
          Cloudflare R2
          <span className={data?.r2.connected ? "text-success" : "text-muted-foreground"}>
            {data?.r2.connected ? data.r2.bucket ?? "connected" : "unknown"}
          </span>
        </span>
        <span className="flex items-center justify-between">
          Google login
          <span>{data?.googleAuthEnabled ? "enabled" : "not configured"}</span>
        </span>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Point-in-time check, not a tenant metric or an uptime guarantee.
      </p>
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { activeWorkspace } = useActiveWorkspace();
  const { mode } = useOctoData();

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto scrollbar-slim p-4">
      <Brand />

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Active workspace
        </span>
        <span className="flex items-center gap-2">
          <Boxes className="size-3.5 text-primary" />
          <span className="truncate text-sm font-medium">
            {activeWorkspace?.name ?? "No workspace"}
          </span>
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          role: {activeWorkspace?.role ?? "—"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Workspace
        </span>
        <NavSection items={WORKSPACE_NAV} onNavigate={onNavigate} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Platform
        </span>
        <NavSection items={PLATFORM_NAV} onNavigate={onNavigate} />
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <Separator />
        <SidebarFooter />
        <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
          {mode === "demo"
            ? "Prototype running on labelled fixtures."
            : "Connected to the Octo server."}
        </p>
      </div>
    </div>
  );
}

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-card/40 lg:block">
        <SidebarBody />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-card shadow-2xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10"
              onClick={onClose}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </Button>
            <SidebarBody onNavigate={onClose} />
          </div>
        </div>
      ) : null}
    </>
  );
}
