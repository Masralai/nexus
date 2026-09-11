"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  Command,
  Terminal,
  Lightning,
  ShieldCheck,
  Stack,
  CaretRight,
  Check,
  ArrowRight,
  Copy,
  Play,
  HardDrives,
  Brain,
  ClockClockwise,
  FileCode,
  GithubLogo,
  CheckCircle,
} from "@phosphor-icons/react";
import { useState } from "react";
import { TerminalChrome } from "./components/TerminalChrome";
import { HeroTerminal } from "./components/HeroTerminal";
import { ModelsTerminal } from "./components/ModelsTerminal";
import { ToolsTerminal } from "./components/ToolsTerminal";
import { HarnessTerminal } from "./components/HarnessTerminal";
import { OpenSourceTerminal } from "./components/OpenSourceTerminal";

function Nav() {
  return (
    <nav className="sticky top-0 z-40 bg-[#09090b]/80 backdrop-blur-xl border-b border-zinc-800">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-[64px] flex items-center justify-between gap-6">
        <div className="flex items-center gap-8 shrink-0">
          <div className="flex items-center gap-3">
            
            <span className="font-mono text-[14px] tracking-[-0.02em] font-semibold text-zinc-100">Nexus</span>
            <span className="hidden sm:inline-flex items-center rounded-full bg-zinc-900 border border-zinc-800 px-2 py-1 font-mono text-[10px] tracking-widest text-zinc-400">MODEL AGNOSTIC</span>
          </div>
          <div className="hidden lg:flex items-center gap-6 font-mono text-[12px] tracking-wide text-zinc-400">
            <a href="#capabilities" className="hover:text-zinc-100 transition-colors">Capabilities</a>
            <a href="#how" className="hover:text-zinc-100 transition-colors">How it works</a>
            <a href="#install" className="hover:text-zinc-100 transition-colors">Install</a>
            <a href="https://github.com/masralai/nexus" target="_blank" className="hover:text-zinc-100 transition-colors">GitHub</a>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a href="https://github.com/masralai/nexus" target="_blank" className="hidden md:inline-flex font-mono text-[12px] text-zinc-400 hover:text-zinc-100 transition-colors">View docs</a>
          <a href="#install" className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 font-mono text-[12px] font-semibold tracking-wide text-zinc-950 hover:bg-cyan-300 transition-colors">
            Install now
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  return (
    <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-16 lg:pt-24 pb-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-center min-h-[520px]">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-6 flex flex-col gap-6"
        >
          <h1 className="font-sans text-4xl md:text-5xl lg:text-[56px] font-[650] tracking-[-0.04em] leading-[0.95] text-zinc-100">
            The terminal
            <br />
            <span className="text-zinc-100">that ships.</span>
          </h1>
          <p className="max-w-[520px] text-[16px] leading-relaxed text-zinc-400">
            Model agnostic harness for developers who live in the shell. Bring your key, choose your model, keep your sessions.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a href="#install" className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-6 py-3 font-mono text-[13px] font-semibold tracking-wide text-zinc-950 hover:bg-cyan-300 transition-colors">
              Install now
              <ArrowRight size={14} weight="bold" />
            </a>
            <a href="https://github.com/masralai/nexus" target="_blank" className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-6 py-3 font-mono text-[13px] font-medium tracking-wide text-zinc-200 hover:bg-zinc-800 transition-colors">
              View docs
            </a>
          </div>
          
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-6 lg:pl-6"
        >
          <TerminalChrome
            ariaLabel="Terminal session showing code and tool calls"
            footerLeft="Session persisted to ~/.nexus/sessions/"
            footerRight="3 tools called"
          >
            <HeroTerminal />
          </TerminalChrome>
          <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-zinc-500">
            <Copy size={12} className="text-zinc-600" />
            <span>curl -fsSL get.nexus.run | sh</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function ProvidersMarquee() {
  const providers = [
    { name: "OpenAI", slug: "openai" },
    { name: "Anthropic", slug: "anthropic" },
    { name: "Gemini", slug: "google" },
    { name: "OpenRouter", slug: "openrouter" },
    { name: "Groq", slug: "groq" },
    { name: "DeepSeek", slug: "deepseek" },
    { name: "Ollama", slug: "ollama" },
  ];
  const doubled = [...providers, ...providers];
  return (
    <section className="border-y border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-zinc-500 shrink-0 hidden md:block">Works with any provider</p>
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-zinc-900/40 to-transparent pointer-events-none z-10" />
          <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-zinc-900/40 to-transparent pointer-events-none z-10" />
          <div className="flex animate-[marquee_28s_linear_infinite] hover:[animation-play-state:paused] gap-10 will-change-transform">
            {doubled.map((p, i) => (
              <div key={`${p.slug}-${i}`} className="flex items-center gap-2.5 shrink-0 opacity-70 hover:opacity-100 transition-opacity">
                <img src={`https://cdn.simpleicons.org/${p.slug}/ffffff`} alt={p.name} className="h-5 w-auto" />
                <span className="font-mono text-[12px] tracking-wide text-zinc-300">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes marquee { 0% { transform: translateX(0) } 100% { transform: translateX(-50%) } }`}</style>
    </section>
  );
}

function HowItWorks() {
  const reduce = useReducedMotion();
  const steps = [
    { n: "01", title: "Install", desc: "One binary. No daemon. Drops into your shell and respects your cwd.", icon: HardDrives },
    { n: "02", title: "Connect a model", desc: "Bring your own key. OpenAI, Anthropic, Gemini. Switch mid session.", icon: Brain },
    { n: "03", title: "Ship in build mode", desc: "Plan is read only. Build has tools, permission gate, and full context.", icon: ShieldCheck },
  ];
  return (
    <section id="how" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
      <div className="max-w-[640px] mb-12">
        <h2 className="font-sans text-3xl md:text-4xl font-semibold tracking-[-0.03em] leading-none text-zinc-100">From prompt to pull request in three moves.</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-400 max-w-[60ch]">No onboarding flow. No cloud project. Your terminal is the interface.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {steps.map((s, i) => (
          <motion.div
            key={s.n}
            initial={reduce ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] tracking-widest text-cyan-400">{s.n}</span>
              <s.icon size={18} className="text-zinc-500" />
            </div>
            <h3 className="font-sans text-[18px] font-semibold tracking-tight text-zinc-100">{s.title}</h3>
            <p className="text-[14px] leading-relaxed text-zinc-400">{s.desc}</p>
            <div className="mt-2 font-mono text-[11px] text-zinc-600 border-t border-zinc-800 pt-4">Step {s.n} of 03</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function CapabilitiesBento() {
  const reduce = useReducedMotion();
  return (
    <section id="capabilities" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-20 lg:pb-28">
      <div className="mb-10">
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-cyan-400 mb-3">Capabilities</p>
        <h2 className="font-sans text-3xl md:text-4xl font-semibold tracking-[-0.03em] text-zinc-100 leading-none">Everything in the shell. Nothing outside it.</h2>
        <p className="mt-3 text-[15px] text-zinc-400 max-w-[60ch]">Nexus is a harness, not a platform. It gives models real tools and durable sessions.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 auto-rows-[280px]">
        <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="md:col-span-7 rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
          <div className="flex-1 grid grid-cols-2 gap-0">
            <div className="p-6 flex flex-col justify-center gap-3">
              <Command size={20} className="text-cyan-400" />
              <h3 className="font-sans text-[18px] font-semibold text-zinc-100">Any provider</h3>
              <p className="text-[13px] leading-relaxed text-zinc-400">One config for OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Ollama. Swap without losing context.</p>
              <div className="flex flex-wrap gap-2 pt-2 font-mono text-[10px] tracking-wide">
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-zinc-300">GPT 4o</span>
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-zinc-300">Claude 4</span>
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-zinc-300">Gemini 2.5</span>
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-zinc-300">Ollama</span>
              </div>
            </div>
            <div className="h-full flex flex-col min-h-[280px]" role="img" aria-label="Model picker showing available models">
              <ModelsTerminal />
            </div>
          </div>
        </motion.div>

        <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.06 }} className="md:col-span-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 flex flex-col justify-between">
          <div>
            <Stack size={20} className="text-cyan-400" />
            <h3 className="mt-3 font-sans text-[18px] font-semibold text-zinc-100">Sessions that persist</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">JSONL under ~/.nexus/sessions. Resume any session. No cloud required.</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
            <div className="text-zinc-500">~/.nexus/sessions/2026-09-09.jsonl</div>
            <div className="text-zinc-300 mt-1">{"{ \"turn\": 3, \"messages\": 42, \"status\": \"done\" }"}</div>
          </div>
        </motion.div>

        <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.08 }} className="md:col-span-5 rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col" role="img" aria-label="Close up of keyboard and terminal">
          <div className="flex-1 min-h-[180px]">
            <ToolsTerminal />
          </div>
          <div className="p-6 border-t border-zinc-800 bg-zinc-900">
            <h3 className="font-sans text-[16px] font-semibold text-zinc-100">Seven tools that cover the workspace</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">read, list, glob, grep, write, edit, bash. Permission gate asks for mutators.</p>
          </div>
        </motion.div>

        <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.1 }} className="md:col-span-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 flex flex-col gap-3">
          <ShieldCheck size={20} className="text-cyan-400" />
          <h3 className="font-sans text-[16px] font-semibold text-zinc-100">Plan and build modes</h3>
          <p className="text-[13px] leading-relaxed text-zinc-400">Plan is read only and auto allowed. Build prompts for writes and bash.</p>
          <div className="mt-2 flex items-center gap-2 font-mono text-[11px]">
            <span className="rounded-full bg-zinc-800 px-3 py-1 text-zinc-300">/plan</span>
            <span className="text-zinc-600">/</span>
            <span className="rounded-full bg-cyan-400 px-3 py-1 text-zinc-950">/build</span>
          </div>
        </motion.div>

        <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.12 }} className="md:col-span-3 rounded-2xl border border-zinc-800 bg-[#09090b] p-6 flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent pointer-events-none" />
          <Lightning size={20} className="text-cyan-400" />
          <h3 className="font-sans text-[16px] font-semibold text-zinc-100 relative">Context assembly</h3>
          <p className="text-[13px] leading-relaxed text-zinc-400 relative">Working memory and compaction keep the prompt lean without losing history.</p>
          <span className="font-mono text-[11px] text-zinc-500 relative">Zero cloud sync</span>
        </motion.div>
      </div>
    </section>
  );
}

function ModelHarness() {
  return (
    <section className="bg-zinc-900 border-y border-zinc-800">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-24">
        <div className="rounded-2xl border border-zinc-800 bg-[#09090b] overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="p-8 lg:p-10 flex flex-col justify-center gap-6">
              <h2 className="font-sans text-3xl md:text-4xl font-semibold tracking-[-0.03em] leading-none text-zinc-100">Model agnostic by design. Not by marketing.</h2>
              <p className="text-[15px] leading-relaxed text-zinc-400">Nexus talks to any provider through one Turn launcher. Same Tools, same Sessions, same Stream viewport. No rewrite when you switch models.</p>
              <ul className="space-y-3 font-mono text-[13px] text-zinc-300">
                <li className="flex items-center gap-3"><Check size={14} className="text-cyan-400" /> Streaming tokens and tool calls</li>
                <li className="flex items-center gap-3"><Check size={14} className="text-cyan-400" /> BYOK in ~/.nexus/credentials.json</li>
                <li className="flex items-center gap-3"><Check size={14} className="text-cyan-400" /> Env vars override file</li>
              </ul>
              <div className="flex gap-3 pt-2">
                <a href="#install" className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 font-mono text-[12px] font-semibold text-zinc-950 hover:bg-cyan-300 transition-colors">Install now</a>
                <a href="https://github.com/masralai/nexus" target="_blank" className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-5 py-2.5 font-mono text-[12px] text-zinc-300 hover:bg-zinc-800 transition-colors">View docs <CaretRight size={12} /></a>
              </div>
            </div>
            <div className="bg-zinc-900 border-t lg:border-t-0 lg:border-l border-zinc-800 p-4 lg:p-6 flex flex-col gap-4" role="img" aria-label="Developer working at desk with multiple monitors">
              <div className="rounded-xl border border-zinc-800 overflow-hidden">
                <HarnessTerminal />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SessionsMetrics() {
  return (
    <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-5">
          <h2 className="font-sans text-3xl md:text-4xl font-semibold tracking-[-0.03em] leading-none text-zinc-100">Sessions are files. You own them.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-zinc-400">Every Turn appends to JSONL. Resume, fork, or inspect with any tool. Stream viewport is just a window.</p>
          <div className="mt-8 grid grid-cols-3 gap-6 border-t border-zinc-800 pt-8">
            <div>
              <div className="font-mono text-2xl font-semibold tracking-tight text-zinc-100">0.6s</div>
              <div className="font-mono text-[11px] tracking-wide text-zinc-500 mt-1">Cold start</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-semibold tracking-tight text-zinc-100">14 MB</div>
              <div className="font-mono text-[11px] tracking-wide text-zinc-500 mt-1">Binary size</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-semibold tracking-tight text-zinc-100">100 pct</div>
              <div className="font-mono text-[11px] tracking-wide text-zinc-500 mt-1">Local first</div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { title: "Live turn view", desc: "Tokens, tool calls, permission asks. One event stream.", icon: Play },
            { title: "Stream viewport", desc: "Pinned window over messages. Ctrl U and D to scroll.", icon: ClockClockwise },
            { title: "Skills", desc: "Instruction packs from ~/.agents/skills. Activate with /skill.", icon: FileCode },
            { title: "Tools", desc: "read, list, glob, grep, write, edit, bash.", icon: Terminal },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <c.icon size={18} className="text-cyan-400" />
              <h3 className="mt-3 font-sans text-[15px] font-semibold text-zinc-100">{c.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section className="bg-zinc-900 border-y border-zinc-800">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-[#09090b] px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="font-mono text-[11px] tracking-wide text-zinc-400">Open source</span>
              <span className="font-mono text-[11px] text-zinc-600">MIT</span>
            </div>
            <h2 className="mt-6 font-sans text-3xl md:text-4xl font-semibold tracking-[-0.03em] leading-none text-zinc-100">Built in the open. No platform tax.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-zinc-400 max-w-[52ch]">Source on GitHub. One binary, no account, no hosted lock in. Skills, sessions, and tools are plain files you can read and fork.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="https://github.com/masralai/nexus" target="_blank" className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-6 py-3 font-mono text-[13px] font-semibold text-zinc-900 hover:bg-white transition-colors">
                <GithubLogo size={16} weight="fill" /> View on GitHub
              </a>
              <a href="https://github.com/masralai/nexus#architecture" target="_blank" className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-[#09090b] px-6 py-3 font-mono text-[13px] text-zinc-300 hover:bg-zinc-800 transition-colors">Architecture</a>
            </div>
            <div className="mt-8 flex flex-wrap gap-6 font-mono text-[11px] text-zinc-500 border-t border-zinc-800 pt-6">
              <span className="flex items-center gap-2"><CheckCircle size={14} className="text-cyan-400" /> No telemetry</span>
              <span className="flex items-center gap-2"><CheckCircle size={14} className="text-cyan-400" /> Sessions are JSONL</span>
              <span className="flex items-center gap-2"><CheckCircle size={14} className="text-cyan-400" /> BYOK only</span>
            </div>
          </div>
          <div className="lg:col-span-6 lg:pl-8">
            <div className="rounded-2xl border border-zinc-800 bg-[#09090b] overflow-hidden" role="img" aria-label="Code editor showing open source repository">
              <OpenSourceTerminal />
              <div className="px-4 py-4 grid grid-cols-3 divide-x divide-zinc-800 border-t border-zinc-800 bg-zinc-900">
                <div className="px-2">
                  <div className="font-mono text-[11px] text-zinc-500">Bun</div>
                  <div className="font-mono text-[13px] font-semibold text-zinc-100">1.0 plus</div>
                </div>
                <div className="px-4">
                  <div className="font-mono text-[11px] text-zinc-500">TypeScript</div>
                  <div className="font-mono text-[13px] font-semibold text-zinc-100">5.x</div>
                </div>
                <div className="px-4">
                  <div className="font-mono text-[11px] text-zinc-500">License</div>
                  <div className="font-mono text-[13px] font-semibold text-zinc-100">MIT</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InstallSection() {
  const [active, setActive] = useState<"linux" | "windows" | "source">("linux");
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(active);
    setTimeout(() => setCopied(null), 1500);
  };
  const tabs = [
    {
      id: "linux" as const,
      label: "LINUX / MACOS",
      title: "LINUX / MACOS",
      desc: "One command installs the correct binary automatically.",
      cmd: "curl -fsSL https://raw.githubusercontent.com/masralai/nexus/main/scripts/install.sh | sh",
      installNote: "Installs to",
      path: "$HOME/.local/bin",
      suffix: "by default. Override with DIR=/usr/local/bin sh.",
    },
    {
      id: "windows" as const,
      label: "WINDOWS",
      title: "WINDOWS",
      desc: "One command installs the correct binary automatically.",
      cmd: "irm https://raw.githubusercontent.com/masralai/nexus/main/scripts/install.ps1 | iex",
      installNote: "Installs to",
      path: "%USERPROFILE%\\.local\\bin",
      suffix: "by default.",
    },
    {
      id: "source" as const,
      label: "FROM SOURCE",
      title: "FROM SOURCE",
      desc: "Clone and build. No install script needed.",
      cmd: "git clone https://github.com/masralai/nexus\ncd nexus\nbun install\nbun run src/cli/main.ts --help",
      installNote: "Requires Bun >=1.0. Binary at",
      path: "./dist/nexus",
      suffix: "after bun run build:compile.",
    },
  ];
  const current = tabs.find((t) => t.id === active)!;
  const reduce = useReducedMotion();
  return (
    <section id="install" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
      <div className="max-w-[720px] mb-8">
        <h2 className="font-sans text-3xl md:text-4xl font-semibold tracking-[-0.03em] leading-none text-zinc-100">Install in one line.</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">Copy, paste, run. Add your key with /key and start your first Turn.</p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
        <div className="flex gap-2 px-2 py-2 bg-[#09090b] border-b border-zinc-800 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`shrink-0 rounded border px-4 py-2 font-mono text-[11px] tracking-wide transition-colors ${active === t.id ? "bg-zinc-900 border-zinc-600 text-zinc-100 shadow-sm ring-1 ring-cyan-400/20" : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"}`}
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
          className="bg-[#09090b] p-8 lg:p-10"
        >
          <h3 className="font-mono text-[14px] font-semibold tracking-[-0.02em] text-zinc-100">{current.title}</h3>
          <p className="mt-3 font-mono text-[13px] leading-relaxed text-zinc-400">{current.desc}</p>

          <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
            <div className="relative p-4 pr-20">
              <pre className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">
                <span className="text-cyan-400">{current.cmd.split(" ")[0]}</span>
                <span className="text-zinc-300"> {current.cmd.slice(current.cmd.indexOf(" ") + 1)}</span>
              </pre>
              <button onClick={() => copy(current.cmd)} className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] tracking-wide text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
                {copied === active ? <Check size={12} className="text-cyan-400" /> : <Copy size={12} />}
                {copied === active ? "COPIED" : "COPY"}
              </button>
            </div>
            <div className="border-t border-zinc-800 bg-zinc-900/50 px-4 py-3 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-zinc-500">
              <span>{current.installNote}</span>
              <span className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-cyan-400">{current.path}</span>
              <span>{current.suffix}</span>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-[#09090b] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[12px] font-semibold text-zinc-100">Next step after install</div>
          <div className="font-mono text-[12px] text-zinc-500 mt-1">nexus then /key to pick provider, /model to pick model, then type a task.</div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-cyan-400" /> Works offline after install</span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 font-mono text-[11px] text-zinc-500">
        <span>Custom repo: NEXUS_INSTALL_REPO=myorg/nexus sh web/install.sh</span>
        <span className="text-zinc-700">/</span>
        <a href="https://github.com/masralai/nexus#quick-start" target="_blank" className="text-zinc-400 hover:text-zinc-200 underline underline-offset-4">Quick start on GitHub</a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-[#09090b]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col md:flex-row justify-between gap-8">
        <div>
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-lg bg-zinc-800 flex items-center justify-center border border-zinc-700">
              <Terminal size={12} className="text-zinc-400" weight="bold" />
            </div>
            <span className="font-mono text-[13px] font-semibold tracking-tight text-zinc-100">nexus</span>
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-zinc-500 max-w-[320px]">Terminal first AI coding agent. Model agnostic harness for software development.</p>
        </div>
        <div className="flex gap-10 font-mono text-[12px]">
          <div>
            <div className="text-zinc-500 mb-3">Product</div>
            <div className="flex flex-col gap-2 text-zinc-300">
              <a href="#capabilities" className="hover:text-zinc-100">Capabilities</a>
              <a href="#how" className="hover:text-zinc-100">How it works</a>
              <a href="#install" className="hover:text-zinc-100">Install</a>
            </div>
          </div>
          <div>
            <div className="text-zinc-500 mb-3">Connect</div>
            <div className="flex flex-col gap-2 text-zinc-300">
              <a href="https://github.com/masralai/nexus" target="_blank" className="hover:text-zinc-100">GitHub</a>
              <a href="https://github.com/masralai/nexus/blob/main/README.md" target="_blank" className="hover:text-zinc-100">Docs</a>
              <a href="https://github.com/masralai/nexus/issues" target="_blank" className="hover:text-zinc-100">Issues</a>
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 border-t border-zinc-800 flex flex-col sm:flex-row justify-between gap-3 font-mono text-[11px] text-zinc-600">
        <span>2026 Nexus. MIT License.</span>
        <span className="flex gap-4"><a href="https://github.com/masralai/nexus" target="_blank" className="hover:text-zinc-400">GitHub</a><span>Open source</span></span>
      </div>
    </footer>
  );
}

export default function Page() {
  return (
    <main className="bg-[#09090b] min-h-screen">
      <Nav />
      <Hero />
      <ProvidersMarquee />
      <HowItWorks />
      <CapabilitiesBento />
      <ModelHarness />
      <SessionsMetrics />
      <OpenSource />
      <InstallSection />
      <Footer />
    </main>
  );
}
