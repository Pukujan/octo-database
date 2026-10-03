import { Boxes, ChevronDown } from "lucide-react";
import { Button } from "@v2/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v2/components/ui/dropdown-menu";
import { Badge } from "@v2/components/ui/badge";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import { cn } from "@v2/lib/utils";

export function WorkspaceSelector() {
  const { workspaces, activeWorkspace, setActiveWorkspaceId, isLoading } = useActiveWorkspace();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[16rem] gap-2" disabled={isLoading}>
          <Boxes className="size-4 shrink-0" />
          <span className="truncate">
            {activeWorkspace ? activeWorkspace.name : isLoading ? "Loading…" : "No workspace"}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Authorized workspaces</DropdownMenuLabel>
        {workspaces.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No workspaces returned for this identity.
          </div>
        ) : (
          workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onSelect={() => setActiveWorkspaceId(workspace.id)}
              className={cn(
                "flex-col items-start gap-1 py-2",
                workspace.id === activeWorkspace?.id && "bg-accent/60",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{workspace.name}</span>
                <Badge variant={workspace.isOwner ? "default" : "outline"}>{workspace.role}</Badge>
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {workspace.slug} · {workspace.description ?? "No description"}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Selection is convenience, not permission. The API enforces every action.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
