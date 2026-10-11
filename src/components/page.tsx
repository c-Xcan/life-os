import * as React from "react";
import { cn } from "@/lib/utils";

/** 统一的页面容器：所有页面使用相同的最大宽度和内边距 */
export const PAGE_WIDTH = "max-w-6xl";

export function Page({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full px-4 pt-2 pb-6 md:p-6", PAGE_WIDTH, className)} {...props} />;
}

/** 统一的页头：标题 + 说明 + 右侧操作 */
export function PageHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3 md:mb-6 md:gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[28px] leading-tight font-semibold tracking-tight md:text-2xl">{title}</h2>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}
