"use client";

import { motion, useReducedMotion } from "motion/react";

const harnessLines = [
  { text: "▶ bash {\"command\":\"bun test\"} …", color: "text-[#A5D6FF]" },
  { text: "  ok 42 tests passed — 1.2s", color: "text-[#A5D6FF]" },
  { text: "fix: handle compact threshold at 0.8 — truncate only prompt, keep history", color: "text-[#E6EDF3]" },
  { text: "```ts // src/engine/context.ts", color: "text-[#A5D6FF] pl-4" },
  { text: "if (pct > threshold) await maybeCompact(messages)", color: "text-[#A5D6FF] pl-4" },
  { text: "```", color: "text-[#A5D6FF] pl-4" },
  { text: "All checks green. Turn complete in 3 steps.", color: "text-[#E6EDF3]" },
];

export function HarnessTerminal() {
  const reduce = useReducedMotion();
  return (
    <div className="bg-[#09090b] p-4 flex flex-col gap-1 font-mono text-[11px] leading-relaxed min-h-[240px]">
      <div className="text-[10px] tracking-wide text-zinc-500 mb-1">Turn launcher — single seam</div>
      <div className="flex flex-col gap-1">
        {harnessLines.map((l, i) => {
          if (reduce) {
            return (
              <div key={i} className={`${l.color} whitespace-pre-wrap break-words`}>
                {l.text}
              </div>
            );
          }
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
              className={`${l.color} whitespace-pre-wrap break-words`}
            >
              {l.text}
            </motion.div>
          );
        })}
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span className="text-zinc-500">CTX</span>
          <span className="text-[#E6EDF3]">9995/1000000 (1%)</span>
          <span className="text-zinc-700">·</span>
          <span className="text-[#E6EDF3]">gemini-2.5-flash</span>
          {!reduce ? <span className="ml-1 inline-block size-1.5 rounded-full bg-cyan-400 animate-pulse" /> : null}
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 flex items-center justify-between">
        <div className="text-[11px]">
          <div className="text-zinc-100">Turn launcher single seam</div>
          <div className="text-[10px] text-zinc-500">CLI and shell share one path</div>
        </div>
        <span className="rounded-full bg-cyan-400 px-3 py-1 font-mono text-[11px] font-semibold text-zinc-950">Active</span>
      </div>
    </div>
  );
}
