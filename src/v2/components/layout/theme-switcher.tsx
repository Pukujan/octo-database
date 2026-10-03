import { Check, ChevronDown, Palette } from "lucide-react";
import { Button } from "@v2/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v2/components/ui/dropdown-menu";
import { useTheme } from "@v2/design/theme";

/**
 * Switches between interchangeable design systems at runtime.
 *
 * Only semantic tokens change, so no page or component is aware of the swap.
 */
export function ThemeSwitcher() {
  const { theme, presets, setTheme, preset } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label="Change design system">
          <Palette className="size-4" />
          <span className="hidden md:inline">{preset.name}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Design system</DropdownMenuLabel>
        {presets.map((candidate) => (
          <DropdownMenuItem
            key={candidate.id}
            onSelect={() => setTheme(candidate.id)}
            className="items-start gap-3 py-2"
          >
            <span className="mt-0.5 flex shrink-0 gap-1">
              {candidate.swatch.map((colour) => (
                <span
                  key={colour}
                  className="size-3.5 rounded-full border border-border"
                  style={{ backgroundColor: colour }}
                />
              ))}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium leading-tight">{candidate.name}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">
                {candidate.blurb}
              </span>
            </span>
            {theme === candidate.id ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Themes are pure CSS tokens — add one block in{" "}
          <code className="font-mono">globals.css</code> to add a design system.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
