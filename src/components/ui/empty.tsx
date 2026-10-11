import * as React from "react";
import { cn } from "@/lib/utils";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-header" className={cn("flex max-w-sm flex-col items-center gap-1.5", className)} {...props} />;
}

function EmptyMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "icon" }) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(
        "mb-1 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "icon" && "bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-title" className={cn("text-sm font-medium tracking-tight", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="empty-description" className={cn("text-muted-foreground text-sm text-balance", className)} {...props} />;
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-content" className={cn("flex flex-wrap items-center justify-center gap-2", className)} {...props} />;
}

export { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent };
