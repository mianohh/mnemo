"use client";

import * as React from "react";
import { CheckIcon, ClipboardIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return textOf(props.children);
  }
  return "";
}

function classNameOf(node: React.ReactNode): string {
  if (React.isValidElement(node)) {
    const props = node.props as { className?: unknown };
    return typeof props.className === "string" ? props.className : "";
  }
  return "";
}

/**
 * One markdown code block with a one-click copy button. Rendered through
 * ReactMarkdown's `components={{ pre }}` override so every fenced block in
 * every message gets it (plus a language badge when the fence declares one).
 */
export function CodeBlock(
  props: React.ComponentProps<"pre"> & { node?: unknown }
) {
  const { children, className, ...rest } = props;
  // react-markdown hands over its AST node; it is not a DOM attribute.
  delete rest.node;

  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const codeChild = React.Children.toArray(children)[0];
  const language =
    `${className ?? ""} ${classNameOf(codeChild)}`
      .match(/language-([\w+#-]+)/)?.[1] ?? "";
  const raw = textOf(children);

  const copy = () => {
    if (!raw) return;
    void navigator.clipboard
      .writeText(raw)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="code-block group/code relative my-2 overflow-hidden rounded-lg bg-foreground shadow-sm ring-1 ring-foreground/20">
      <div className="flex items-center justify-between gap-2 border-b border-background/15 px-3 py-1.5">
        <span className="font-mono text-[11px] tracking-wide text-background/70">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
            "text-background/70 hover:bg-background/15 hover:text-background",
            copied && "text-emerald-300"
          )}
        >
          {copied ? (
            <CheckIcon className="size-3" />
          ) : (
            <ClipboardIcon className="size-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        {...rest}
        className={cn(
          "m-0 overflow-x-auto bg-transparent p-3 text-background",
          className
        )}
      >
        {children}
      </pre>
    </div>
  );
}
