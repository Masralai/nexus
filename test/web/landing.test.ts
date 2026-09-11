import { expect, test, describe } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const pagePath = join(ROOT, "web/app/page.tsx");
const configPath = join(ROOT, "web/next.config.mjs");

describe("landing placeholders removed", () => {
  test("web/app/page.tsx contains no picsum.photos", () => {
    const src = readFileSync(pagePath, "utf8");
    expect(src).not.toContain("picsum.photos");
  });

  test("web/next.config.mjs contains no picsum.photos", () => {
    const src = readFileSync(configPath, "utf8");
    expect(src).not.toContain("picsum.photos");
    expect(src).toContain("cdn.simpleicons.org");
  });

  test("page retains provider marquee", () => {
    const src = readFileSync(pagePath, "utf8");
    expect(src).toContain("Works with any provider");
    expect(src).toContain("ProvidersMarquee");
  });
});

describe("terminal components exist and render expected content", () => {
  test("TerminalChrome component exists", () => {
    const p = join(ROOT, "web/app/components/TerminalChrome.tsx");
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, "utf8");
    expect(src).toContain("TerminalChrome");
    expect(src).toContain("nexus build mode");
  });

  test("HeroTerminal renders gemini-2.5-flash and build prompt without steps", () => {
    const src = readFileSync(join(ROOT, "web/app/components/HeroTerminal.tsx"), "utf8");
    expect(src).toContain("gemini-2.5-flash");
    expect(src).toContain("look for vulnerabilities");
    expect(src).toContain("build");
    expect(src).toContain("MODE build");
    expect(src).toContain("CTX");
    expect(src).not.toContain("steps 3");
    expect(src).not.toContain("steps 7");
  });

  test("ModelsTerminal shows /model picker with sonnet selected", () => {
    const src = readFileSync(join(ROOT, "web/app/components/ModelsTerminal.tsx"), "utf8");
    expect(src).toContain("claude-sonnet-4");
    expect(src).toContain("/model");
  });

  test("ToolsTerminal shows tool calls and permission gate", () => {
    const src = readFileSync(join(ROOT, "web/app/components/ToolsTerminal.tsx"), "utf8");
    expect(src).toContain("▶ read");
    expect(src).toContain("ok");
    expect(src).toContain("Allow");
  });

  test("HarnessTerminal shows live Turn stream without steps footer", () => {
    const src = readFileSync(join(ROOT, "web/app/components/HarnessTerminal.tsx"), "utf8");
    expect(src).toContain("▶");
    expect(src.toLowerCase()).toContain("ctx");
    expect(src).toContain("gemini-2.5-flash");
    expect(src).not.toContain("steps</span>");
  });

  test("OpenSourceTerminal shows session JSONL", () => {
    const src = readFileSync(join(ROOT, "web/app/components/OpenSourceTerminal.tsx"), "utf8");
    expect(src).toContain(".nexus/sessions");
    expect(src).toContain("jsonl");
  });
});

describe("subtle animation respects reduced motion", () => {
  test("HeroTerminal uses useReducedMotion", () => {
    const src = readFileSync(join(ROOT, "web/app/components/HeroTerminal.tsx"), "utf8");
    expect(src).toContain("useReducedMotion");
  });
  test("HarnessTerminal uses useReducedMotion", () => {
    const src = readFileSync(join(ROOT, "web/app/components/HarnessTerminal.tsx"), "utf8");
    expect(src).toContain("useReducedMotion");
  });
});
