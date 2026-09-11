"use client";

import type { ReactNode } from "react";

export interface TerminalChromeProps {
  title?: string;
  cwd?: string;
  ariaLabel: string;
  footerLeft?: string;
  footerRight?: string;
  footerRightColor?: string;
  children: ReactNode;
  className?: string;
}

export function TerminalChrome({
  title = "nexus build mode",
  cwd = "~/projects/nexus",
  ariaLabel,
  footerLeft,
  footerRight,
  footerRightColor = "text-cyan-400",
  children,
  className = "",
}: TerminalChromeProps) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={`relative rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col ${className}`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-zinc-700" />
          <span className="size-3 rounded-full bg-zinc-700" />
          <span className="size-3 rounded-full bg-zinc-700" />
        </div>
        <span className="font-mono text-[11px] tracking-wide text-zinc-500">{title}</span>
        <span className="font-mono text-[11px] text-zinc-500 hidden sm:inline">{cwd}</span>
      </div>
      <div className="flex-1 bg-[#09090b] font-mono text-[12px] leading-[1.55] overflow-hidden">
        {children}
      </div>
      {footerLeft || footerRight ? (
        <div className="px-4 py-3 flex items-center justify-between bg-zinc-900 border-t border-zinc-800 shrink-0">
          <span className="font-mono text-[11px] text-zinc-500 truncate pr-4">{footerLeft}</span>
          {footerRight ? (
            <span className={`font-mono text-[11px] ${footerRightColor} shrink-0`}>{footerRight}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
