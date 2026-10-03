import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@v2/lib/utils";

const alertVariants = cva(
  "relative flex w-full gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        muted: "border-border bg-muted/60 text-muted-foreground",
        warning: "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning",
        destructive: "border-destructive/40 bg-destructive/10 text-foreground [&>svg]:text-destructive",
        success: "border-success/40 bg-success/10 text-foreground [&>svg]:text-success",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface AlertProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("text-sm font-medium leading-5", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("text-xs leading-relaxed text-muted-foreground", className)} {...props} />
  );
}
