import { Menu } from "lucide-react";
import { Button } from "@v2/components/ui/button";
import { DataModeSwitcher } from "./data-mode-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import { UserMenu } from "./user-menu";
import { WorkspaceSelector } from "./workspace-selector";

export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenSidebar}
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </Button>

        <WorkspaceSelector />

        <div className="ml-auto flex items-center gap-2">
          <DataModeSwitcher />
          <ThemeSwitcher />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
