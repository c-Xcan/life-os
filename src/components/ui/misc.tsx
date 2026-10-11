"use client";
import * as React from "react";
import { Progress as ProgressPrimitive, ScrollArea as ScrollAreaPrimitive, Collapsible as CollapsiblePrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/* Skeleton */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("bg-accent animate-pulse rounded-md", className)} {...props} />;
}

/* Progress */
export function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn("bg-primary/20 relative h-2 w-full overflow-hidden rounded-full", className)} {...props}>
      <ProgressPrimitive.Indicator data-slot="progress-indicator" className="bg-primary h-full w-full flex-1 transition-all" style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
    </ProgressPrimitive.Root>
  );
}

/* ScrollArea */
export function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
      <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" className="size-full rounded-[inherit] outline-none [&>div]:!block">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex touch-none p-px transition-colors select-none h-full w-2.5 border-l border-l-transparent">
        <ScrollAreaPrimitive.Thumb className="bg-border relative flex-1 rounded-full" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

/* Collapsible */
export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const CollapsibleContent = CollapsiblePrimitive.Content;

/* Alert */
export function Alert({ className, variant = "default", ...props }: React.ComponentProps<"div"> & { variant?: "default" | "destructive" }) {
  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
        variant === "destructive" ? "text-destructive bg-card [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90" : "bg-card text-card-foreground",
        className
      )}
      {...props}
    />
  );
}
export function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)} {...props} />;
}
export function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("text-muted-foreground col-start-2 text-sm [&_p]:leading-relaxed", className)} {...props} />;
}

/* Kbd */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd className={cn("bg-muted text-muted-foreground pointer-events-none inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium select-none", className)} {...props} />;
}
