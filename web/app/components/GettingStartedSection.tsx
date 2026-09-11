"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, Copy, ArrowRight, Terminal } from "@phosphor-icons/react";
import { useState } from "react";

type TabId = "linux" | "windows" | "source";

const installTabs = [
  {
    id: "linux" as const,
    label: "LINUX / MACOS",
    cmd: "curl -fsSL https://raw.githubusercontent.com/masralai/nexus/main/web/install.sh | sh",
    installNote: "Installs to",
    path: "$HOME/.local/bin",
    suffix: "by default. Override with DIR=/usr/local/bin sh.",
  },
  {
    id: "windows" as const,
    label: "WINDOWS",
    cmd: "irm https://raw.githubusercontent.com/masralai/nexus/main/web/install.ps1 | iex",
    installNote: "Installs to",
    path: "%USERPROFILE%\\.local\\bin",
    suffix: "by default.",
  },
  {
    id: "source" as const,
    label: "FROM SOURCE",
    cmd: "git clone https://github.com/masralai/nexus\ncd nexus\nbun install\nbun run src/cli/main.ts --help",
    installNote: "Requires Bun >=1.0. Binary at",
    path: "./dist/nexus",
    suffix: "after bun run build:compile.",
  },
] as const;

function CodeWell({
  cmd,
  copied,
  onCopy,
  monoId,
}: {
  cmd: string;
  copied: boolean;
  onCopy: () => void;
  monoId: string;
}) {
  const firstSpace = cmd.indexOf(" ");
  const head = firstSpace === -1 ? cmd : cmd.slice(0, firstSpace);
  const tail = firstSpace === -1 ? "" : cmd.slice(firstSpace + 1);
  const isMultiline = cmd.includes("\n");
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="relative p-4 pr-[88px]">
        <pre
          id={monoId}
          className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all"
        >
          {isMultiline ? (
            <span className="text-zinc-300">{cmd}</span>
          ) : (
            <>
              <span className="text-cyan-400">{head}</span>
              <span className="text-zinc-300">{tail ? ` ${tail}` : ""}</span>
            </>
          )}
        </pre>
        <button
          onClick={onCopy}
          aria-label={`Copy ${head} command`}
          className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] tracking-wide text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        >
          {copied ? <Check size={12} className="text-cyan-400" /> : <Copy size={12} />}
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
    </div>
  );
}

function StepShell({
  number,
  title,
  desc,
  children,
  delay,
}: {
  number: string;
  title: string;
  desc: string;
  children: React.ReactNode;
  delay: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col"
    >
      <div className="p-6 lg:p-7 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[11px] tracking-widest text-cyan-400">{number}</span>
        </div>
        <div>
          <h3 className="font-sans text-[17px] font-semibold tracking-tight text-zinc-100">{title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400 max-w-[60ch]">{desc}</p>
        </div>
        {children}
      </div>
    </motion.div>
  );
}

export function GettingStartedSection() {
  const [active, setActive] = useState<TabId>("linux");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const current = installTabs.find((t) => t.id === active)!;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <section
      id="getting-started"
      aria-labelledby="getting-started-heading"
      className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32"
    >
      <div id="install" aria-hidden className="sr-only" />
      <div className="max-w-[720px] mb-10">
        <h2
          id="getting-started-heading"
          className="font-sans text-3xl md:text-4xl font-semibold tracking-[-0.03em] leading-none text-zinc-100"
        >
          From install to first Turn in four steps.
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-400 max-w-[60ch]">
          Copy one command, connect your key, pick a model, run a task. Sessions persist as files.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StepShell
          number="01"
          title="Install"
          desc="One binary. No daemon. Drops into your shell and respects your cwd."
          delay={0}
        >
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {installTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                aria-pressed={active === t.id}
                className={`shrink-0 rounded border px-3.5 py-2 font-mono text-[11px] tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
                  active === t.id
                    ? "bg-zinc-950 border-zinc-600 text-zinc-100 shadow-sm ring-1 ring-cyan-400/20"
                    : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <motion.div
            key={active}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-3"
          >
            <p className="font-mono text-[12px] leading-relaxed text-zinc-500">
              {active === "linux" && "One command installs the correct binary automatically."}
              {active === "windows" && "One command installs the correct binary automatically."}
              {active === "source" && "Clone and build. No install script needed."}
            </p>
            <CodeWell
              monoId="gs-cmd-install"
              cmd={current.cmd}
              copied={copiedKey === `install-${active}`}
              onCopy={() => copy(current.cmd, `install-${active}`)}
            />
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-zinc-500">
              <span>{current.installNote}</span>
              <span className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-cyan-400">
                {current.path}
              </span>
              <span>{current.suffix}</span>
            </div>
            <div className="flex flex-wrap gap-3 font-mono text-[11px] text-zinc-600 pt-1 border-t border-zinc-800">
              <span>Custom repo: NEXUS_INSTALL_REPO=myorg/nexus sh web/install.sh</span>
            </div>
          </motion.div>
        </StepShell>

        <StepShell
          number="02"
          title="Connect your key"
          desc="Run nexus, then /key to choose a provider. Keys stay local in ~/.nexus/credentials.json."
          delay={0.06}
        >
          <div className="rounded-xl border border-zinc-800 bg-[#09090b] overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
              <span className="font-mono text-[11px] tracking-wide text-zinc-400 inline-flex items-center gap-2">
                <Terminal size={12} className="text-zinc-500" /> nexus shell
              </span>
              <span className="font-mono text-[10px] text-zinc-600">~/.nexus/credentials.json mode 600</span>
            </div>
            <div className="p-4 flex flex-col gap-2 font-mono text-[12.5px] leading-relaxed">
              <div className="text-zinc-500">$ nexus</div>
              <div className="text-cyan-400">/key</div>
              <div className="text-zinc-400 pl-4">Anthropic / OpenAI / Gemini / OpenRouter / Groq / DeepSeek / Ollama</div>
              <div className="text-zinc-300 pl-4">paste key when prompted</div>
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-400">
                Env vars override file: <span className="text-zinc-200">ANTHROPIC_API_KEY</span>,{" "}
                <span className="text-zinc-200">OPENAI_API_KEY</span>,{" "}
                <span className="text-zinc-200">GEMINI_API_KEY</span>
              </div>
            </div>
          </div>
          <CodeWell
            monoId="gs-cmd-key"
            cmd="nexus"
            copied={copiedKey === "key"}
            onCopy={() => copy("nexus", "key")}
          />
          <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
            Inside the shell type <span className="text-zinc-300">/key</span> and pick a provider. Env var wins over file. No account required.
          </p>
        </StepShell>

        <StepShell
          number="03"
          title="Pick a model"
          desc="Choose from preset suggestions or type a custom id. Switch mid session without losing context."
          delay={0.1}
        >
          <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-4 flex flex-col gap-2 font-mono text-[11px] leading-relaxed">
            <div className="text-zinc-500 text-[10px] tracking-wide">Select model (/model)</div>
            <div className="flex items-center gap-2 text-[#58A6FF]">
              <span>❯</span>
              <span className="text-[#E6EDF3]">claude-sonnet-4</span>
              <span className="text-[10px] tracking-wide text-[#58A6FF] ml-1">selected</span>
            </div>
            <div className="text-zinc-500 pl-4 flex items-center gap-2">
              <span>gpt-4o</span>
              <span className="text-[10px] text-zinc-600">openai</span>
            </div>
            <div className="text-zinc-500 pl-4 flex items-center gap-2">
              <span>gemini-2.5-flash</span>
              <span className="text-[10px] text-zinc-600">google</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-500 mt-1">
              <span className="text-[#A5D6FF]">connected:</span> anthropic · claude-sonnet-4
            </div>
            <div className="text-[10px] text-zinc-600">↑↓ select · Enter confirm · Esc cancel</div>
          </div>
          <CodeWell
            monoId="gs-cmd-model"
            cmd="/model"
            copied={copiedKey === "model"}
            onCopy={() => copy("/model", "model")}
          />
          <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
            In the shell run <span className="text-zinc-300">/model</span> or start headless with{" "}
            <span className="text-zinc-300">--model gpt-4o</span>.
          </p>
        </StepShell>

        <StepShell
          number="04"
          title="Run your first Turn"
          desc="Type a task and press Enter. Or go headless for CI. Sessions append to JSONL."
          delay={0.14}
        >
          <div className="rounded-xl border border-zinc-800 bg-[#09090b] overflow-hidden">
            <div className="p-4 flex flex-col gap-1.5 font-mono text-[11px] leading-relaxed">
              <div className="text-zinc-500">$ nexus run &quot;add tests for session resume&quot; --yes</div>
              <div className="text-[#A5D6FF]">▶ read {"{\"path\":\"src/engine/state.ts\"}"}</div>
              <div className="text-[#A5D6FF] pl-2">ok 42 lines</div>
              <div className="text-[#E6EDF3]">Turn complete in 3 steps. Session persisted to ~/.nexus/sessions/</div>
              <div className="mt-2 flex gap-2">
                <span className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300">plan: Shift+Tab</span>
                <span className="rounded bg-cyan-400 px-2 py-1 text-[10px] font-semibold text-zinc-950">build: tools live</span>
              </div>
            </div>
            <div className="border-t border-zinc-800 bg-zinc-900/50 px-4 py-2 flex flex-wrap gap-3 font-mono text-[11px] text-zinc-500">
              <span>resume: nexus resume &lt;id&gt;</span>
              <span className="text-zinc-700">/</span>
              <span>check: nexus self-test</span>
            </div>
          </div>
          <CodeWell
            monoId="gs-cmd-run"
            cmd='nexus run "add tests for session resume" --yes'
            copied={copiedKey === "run"}
            onCopy={() => copy('nexus run "add tests for session resume" --yes', "run")}
          />
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-cyan-400" /> Works offline after install
            </span>
            <span className="text-zinc-700">·</span>
            <span>Ctrl+C aborts Turn</span>
          </div>
        </StepShell>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-[#09090b] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[12px] font-semibold text-zinc-100">After these four steps</div>
          <div className="font-mono text-[12px] text-zinc-500 mt-1">
            Sessions are JSONL under ~/.nexus/sessions. Resume, fork, or grep them like any file.
          </div>
        </div>
        <a
          href="https://github.com/masralai/nexus#quick-start"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 font-mono text-[12px] font-semibold text-zinc-950 hover:bg-cyan-300 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 shrink-0"
        >
          View quick start <ArrowRight size={14} weight="bold" />
        </a>
      </div>
    </section>
  );
}
