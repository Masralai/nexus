"use client";

export function ModelsTerminal() {
  return (
    <div className="h-full bg-[#09090b] p-4 flex flex-col">
      <div className="font-mono text-[11px] leading-relaxed">
        <div className="text-zinc-500">Select model (/model)</div>
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-[#58A6FF]">
            <span>❯</span>
            <span className="text-[#E6EDF3]">claude-sonnet-4</span>
            <span className="text-[10px] tracking-wide text-[#58A6FF] ml-1">selected</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-500 pl-4">
            <span>gpt-4o</span>
            <span className="text-[10px] text-zinc-600">openai</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-500 pl-4">
            <span>gemini-2.5-flash</span>
            <span className="text-[10px] text-zinc-600">google</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-500 pl-4">
            <span>ollama/llama3.2</span>
            <span className="text-[10px] text-zinc-600">local</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-500 pl-4">
            <span>Custom…</span>
          </div>
        </div>
        <div className="mt-4 text-[10px] text-zinc-600">↑↓ select · Enter confirm · Esc cancel</div>
        <div className="mt-3 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-500">
          <span className="text-[#A5D6FF]">connected:</span> anthropic · claude-sonnet-4
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">
          <span className="text-zinc-600">MODEL</span> claude-sonnet-4
        </div>
      </div>
    </div>
  );
}
