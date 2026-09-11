"use client";

export function OpenSourceTerminal() {
  return (
    <div className="bg-[#09090b] flex flex-col font-mono text-[11px] leading-relaxed">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900">
        <span className="text-[11px] tracking-wide text-zinc-500">github.com/masralai/nexus</span>
        <span className="text-[11px] text-zinc-600">public</span>
      </div>
      <div className="p-4 flex flex-col gap-1.5">
        <div className="text-zinc-500">$ list ~/.nexus/sessions</div>
        <div className="text-[#A5D6FF]">~/.nexus/sessions/5467a7c8.jsonl</div>
        <div className="text-[#A5D6FF]">~/.nexus/sessions/2026-09-09.jsonl</div>
        <div className="mt-1 text-zinc-500">$ read ~/.nexus/sessions/5467a7c8.jsonl</div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] break-all">
          <div className="text-zinc-500">{"{\"type\":\"meta\",\"session\":{\"id\":\"5467a7c8\",\"model\":\"claude-sonnet-4\"}}"} </div>
          <div className="text-[#E6EDF3] mt-1">{"{\"type\":\"msg\",\"role\":\"user\",\"content\":\"ship it\"}"}</div>
          <div className="text-[#A5D6FF]">{"{\"type\":\"status\",\"status\":\"done\"}"}</div>
        </div>
        <div className="text-[10px] text-zinc-600 mt-1">Sessions are files. You own them. · cat, grep, resume.</div>
      </div>
    </div>
  );
}
