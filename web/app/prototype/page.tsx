"use client";

import { useState } from "react";
import { TerminalChrome } from "../components/TerminalChrome";
import { HeroTerminal } from "../components/HeroTerminal";
import { ModelsTerminal } from "../components/ModelsTerminal";
import { ToolsTerminal } from "../components/ToolsTerminal";
import { HarnessTerminal } from "../components/HarnessTerminal";
import { OpenSourceTerminal } from "../components/OpenSourceTerminal";

export default function PrototypePage() {
  const [heroVariant, setHeroVariant] = useState<"rich" | "empty">("rich");
  return (
    <main className="bg-[#09090b] min-h-screen py-10">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <h1 className="font-mono text-[14px] tracking-widest text-zinc-500 uppercase">Prototype — Terminal review</h1>
          <p className="font-mono text-[12px] text-zinc-400 max-w-[60ch]">
            Throwaway preview for copy and animation timing. Toggle hero empty vs rich to match image.png. Motion respects prefers-reduced-motion.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setHeroVariant("rich")}
              className={`rounded-full border px-4 py-2 font-mono text-[11px] ${heroVariant === "rich" ? "bg-cyan-400 text-zinc-950 border-cyan-400" : "bg-zinc-900 text-zinc-400 border-zinc-800"}`}
            >
              Rich
            </button>
            <button
              onClick={() => setHeroVariant("empty")}
              className={`rounded-full border px-4 py-2 font-mono text-[11px] ${heroVariant === "empty" ? "bg-cyan-400 text-zinc-950 border-cyan-400" : "bg-zinc-900 text-zinc-400 border-zinc-800"}`}
            >
              Empty (image.png)
            </button>
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[12px] text-zinc-300">Hero — build › look for vulnerabilities</h2>
          <TerminalChrome ariaLabel="Prototype hero terminal" footerLeft="Session persisted to ~/.nexus/sessions/" footerRight="3 tools called">
            {heroVariant === "rich" ? <HeroTerminal /> : <div className="p-6 flex flex-col min-h-[240px] justify-between"><div className="text-[#58A6FF] font-bold text-[12px]"> Nexus</div><div className="flex items-baseline gap-1 text-[12px]"><span className="text-[#58A6FF]">build ›</span><span className="text-[#E6EDF3]">look for vulnerabilities and provide a security report</span><span className="text-[#58A6FF] animate-[blink_1s_steps(1)_infinite]">█</span></div><div className="font-mono text-[11px] text-zinc-500">MODE build · MODEL gemini-2.5-flash · CTX 0/0 (0%)</div></div>}
          </TerminalChrome>
          <style>{`@keyframes blink { 0%,50%{opacity:1}51%,100%{opacity:0} }`}</style>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="font-mono text-[12px] text-zinc-300">Models — /model picker</h2>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <ModelsTerminal />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="font-mono text-[12px] text-zinc-300">Tools — 7 tools + permission gate</h2>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <ToolsTerminal />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[12px] text-zinc-300">Harness — Turn launcher</h2>
          <div className="rounded-2xl border border-zinc-800 overflow-hidden">
            <HarnessTerminal />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[12px] text-zinc-300">Open source — sessions as files</h2>
          <div className="rounded-2xl border border-zinc-800 overflow-hidden">
            <OpenSourceTerminal />
          </div>
        </section>
      </div>
    </main>
  );
}
