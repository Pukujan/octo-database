import { Database, FlaskConical } from "lucide-react";
import { Badge } from "@v2/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v2/components/ui/dropdown-menu";
import { Button } from "@v2/components/ui/button";
import { useOctoData } from "@v2/data/provider";

export function DataModeSwitcher() {
  const { mode, setMode } = useOctoData();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {mode === "demo" ? <FlaskConical className="size-4" /> : <Database className="size-4" />}
          <span className="hidden md:inline">{mode === "demo" ? "Demo data" : "Live API"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Data source</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setMode("demo")} className="flex-col items-start gap-1 py-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <FlaskConical className="size-4" /> Demo fixtures
            {mode === "demo" ? <Badge variant="default">Active</Badge> : null}
          </span>
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            Offline deterministic fixtures behind the adapter. Every fixture value is labelled.
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMode("live")} className="flex-col items-start gap-1 py-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Database className="size-4" /> Live Octo API
            {mode === "live" ? <Badge variant="default">Active</Badge> : null}
          </span>
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            Calls <code className="font-mono">/api</code> with the stored session. Requires the
            server on port 3001.
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Pages never call fetch directly — swapping this switches the whole UI.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
