"use client";

export function ToolsTerminal() {
  return (
    <div className="bg-[#09090b] p-4 flex flex-col gap-1.5 font-mono text-[11px] leading-relaxed">
      <div className="text-zinc-500 text-[10px] tracking-wide mb-1">workspace tools — 7 total</div>
      <div className="text-[#A5D6FF]">▶ read {"{\"path\":\"src/engine/permission.ts\"}"}</div>
      <div className="text-[#A5D6FF] pl-2">ok 42 lines — plan denies write/edit/bash</div>
      <div className="text-[#A5D6FF]">▶ grep {"{\"pattern\":\"TODO\"}"}</div>
      <div className="text-[#A5D6FF] pl-2">ok 3 matches — skipped node_modules</div>
      <div className="text-[#A5D6FF]">▶ glob {"{\"pattern\":\"src/**/*.ts\"}"}</div>
      <div className="text-[#A5D6FF] pl-2">ok 18 files</div>
      <div className="mt-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2">
        <div className="text-[11px] text-amber-200">Allow write? · src/tools/index.ts</div>
        <div className="text-[10px] text-zinc-400 mt-1">reason: outside cwd — requires approval</div>
        <div className="mt-2 flex gap-2 font-mono text-[10px]">
          <span className="rounded bg-zinc-800 px-2 py-1 text-zinc-300">Deny</span>
          <span className="rounded bg-cyan-400 px-2 py-1 text-zinc-950">Approve</span>
        </div>
      </div>
      <div className="mt-1 text-[10px] text-zinc-600">read, list, glob, grep · read-only auto-allow · write/edit/bash ask</div>
    </div>
  );
}
