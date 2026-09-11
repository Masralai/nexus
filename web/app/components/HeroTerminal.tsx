"use client";

import { motion, useReducedMotion } from "motion/react";

const lines = [
  { text: " Nexus", color: "text-[#58A6FF] font-bold" },
  { text: " you  look for vulnerabilities and provide a security report", color: "text-[#E6EDF3]", prefix: "you", prefixColor: "text-[#58A6FF]" },
  { text: "▶ read {\"path\":\"src/engine/permission.ts\"}", color: "text-[#A5D6FF]" },
  { text: "  ok 42 lines — permission gate, decide() + gateToolCall()", color: "text-[#A5D6FF]" },
  { text: "▶ grep {\"pattern\":\"eval.*\\(\"}", color: "text-[#A5D6FF]" },
  { text: "  ok 2 matches — src/tools/index.ts:88, src/providers/sse.ts:42", color: "text-[#A5D6FF]" },
  { text: "▶ glob {\"pattern\":\"src/**/*\"}", color: "text-[#A5D6FF]" },
  { text: "  ok 18 files — no new surface", color: "text-[#A5D6FF]" },
  { text: "No critical vulnerabilities. 2 low findings: `grep` avoids node_modules, `bash` is gated. Report written to ./security-report.md", color: "text-[#E6EDF3]" },
];

export function HeroTerminal() {
  const reduce = useReducedMotion();
  return (
    <div className="p-4 flex flex-col gap-0 min-h-[280px] sm:min-h-[320px]">
      {/* stream */}
      <div className="flex-1 flex flex-col gap-1.5">
        {lines.map((l, i) => {
          const content = l.prefix ? (
            <span key={i} className="flex">
              <span className={`${l.prefixColor} mr-2`}>{l.prefix}</span>
              <span className={l.color}>{l.text.replace(/^ you\s+/, "")}</span>
            </span>
          ) : (
            <span className={l.color}>{l.text}</span>
          );

          if (reduce) {
            return (
              <div key={i} className="text-[11px] sm:text-[12px] leading-[1.5] whitespace-pre-wrap break-words">
                {content}
              </div>
            );
          }
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="text-[11px] sm:text-[12px] leading-[1.5] whitespace-pre-wrap break-words"
            >
              {content}
            </motion.div>
          );
        })}
      </div>

      {/* composer — matches image.png: build › look for vulnerabilities and provide a security report █ */}
      <div className="mt-4 pt-3 border-t border-zinc-800/60">
        <div className="flex items-baseline gap-1 text-[11px] sm:text-[12px]">
          <span className="text-[#58A6FF] shrink-0">build ›</span>
          <span className="text-[#E6EDF3]">look for vulnerabilities and provide a security report</span>
          <span
            className={`text-[#58A6FF] ml-0.5 ${reduce ? "" : "animate-[blink_1s_steps(1)_infinite]"}`}
            aria-hidden
          >
            █
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-500">
          <span>MODE build</span>
          <span className="text-zinc-700">·</span>
          <span>MODEL gemini-2.5-flash</span>
          <span className="text-zinc-700">·</span>
          <span>CTX 9995/1000000 (1%)</span>
        </div>
      </div>
      <style>{`@keyframes blink { 0%, 50% { opacity: 1 } 51%, 100% { opacity: 0 } }`}</style>
    </div>
  );
}
