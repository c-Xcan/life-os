"use client";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { attachmentUrl } from "@/lib/image";
import { Lightbox } from "@/components/lightbox";

export function Markdown({ children, className }: { children: string; className?: string }) {
  const text = (children ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div className={cn("prose-md break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => {
            const url = typeof src === "string" ? attachmentUrl(src) : "";
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={url} alt={alt ?? ""} loading="lazy" onClick={() => setOpen(url)} className="my-2 inline-block max-h-96 cursor-zoom-in rounded-lg border object-contain" />;
          },
        }}
      >{text}</ReactMarkdown>
      <Lightbox src={open} onClose={() => setOpen(null)} />
    </div>
  );
}
