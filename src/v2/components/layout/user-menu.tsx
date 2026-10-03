import { LogOut, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@v2/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v2/components/ui/dropdown-menu";
import { Badge } from "@v2/components/ui/badge";
import { useMe } from "@v2/data/hooks";
import { useAuth } from "@v2/auth/use-auth";
import { initials } from "@v2/lib/format";

export function UserMenu() {
  const { data } = useMe();
  const { signOut } = useAuth();
  const principal = data?.principal;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Account menu"
      >
        <Avatar className="size-8 border border-border">
          {principal?.avatarUrl ? <AvatarImage src={principal.avatarUrl} alt="" /> : null}
          <AvatarFallback>
            {initials(principal?.displayName ?? null, principal?.email ?? "")}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Signed in</DropdownMenuLabel>
        <div className="flex flex-col gap-1 px-2 py-1.5">
          <span className="text-sm font-medium">{principal?.displayName ?? "Unknown principal"}</span>
          <span className="truncate text-xs text-muted-foreground">{principal?.email ?? "—"}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {principal?.isPlatformOwner ? <Badge variant="warning">Platform owner</Badge> : null}
            {principal?.isGuest ? <Badge variant="outline">Guest</Badge> : null}
            {data?.confirmSecretSet ? (
              <Badge variant="success">Confirmation secret set</Badge>
            ) : (
              <Badge variant="muted">No confirmation secret</Badge>
            )}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserRound className="size-4" />
          Principal {principal?.id.slice(0, 12) ?? "—"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
