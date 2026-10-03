import * as React from "react";
import { useTheme } from "@v2/design/theme";

const FALLBACK = [
  "hsl(80 74% 62%)",
  "hsl(190 70% 55%)",
  "hsl(265 70% 68%)",
  "hsl(35 85% 60%)",
  "hsl(330 70% 64%)",
];

/**
 * Resolves the active theme's chart tokens to concrete colour strings.
 *
 * Recharts writes colours as SVG attributes, where CSS variables do not
 * resolve, so the computed values are read after each theme change.
 */
export function useChartColors(): string[] {
  const { theme } = useTheme();
  const [colors, setColors] = React.useState<string[]>(FALLBACK);

  React.useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const next = [1, 2, 3, 4, 5]
      .map((index) => styles.getPropertyValue(`--chart-${index}`).trim())
      .filter(Boolean);
    if (next.length === 5) setColors(next);
  }, [theme]);

  return colors;
}

export const chartTooltipStyle = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  fontSize: "12px",
  color: "var(--color-popover-foreground)",
  padding: "0.5rem 0.625rem",
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
} as const;

export const chartAxisProps = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;
