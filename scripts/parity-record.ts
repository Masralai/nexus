#!/usr/bin/env bun
/**
 * Record a parity reference transcript from a reference session export.
 *
 *   <reference-cli> session export --sanitize <session> > /tmp/export.json
 *   bun scripts/parity-record.ts /tmp/export.json --exit-code 0 > fixtures/parity/reference.json
 *
 * Run this only against the pinned reference build with a real model. It is a
 * release action: pull-request CI replays committed transcripts instead.
 */
import { readFileSync } from "node:fs"
import { mapSessionExport } from "../src/parity/session-export"

const args = process.argv.slice(2)
const take = (flag: string): string | undefined => {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined) throw new Error(`${flag} needs a value`)
  args.splice(index, 2)
  return value
}

const exitCode = take("--exit-code")
const promptChars = take("--prompt-chars")
const file = args[0]
if (!file || args.length !== 1) {
  console.error(
    "usage: bun scripts/parity-record.ts <reference-session-export.json> [--exit-code N] [--prompt-chars N]",
  )
  process.exit(2)
}

const transcript = mapSessionExport(JSON.parse(readFileSync(file, "utf8")), {
  ...(exitCode !== undefined ? { exitCode: Number(exitCode) } : {}),
  ...(promptChars !== undefined ? { promptChars: Number(promptChars) } : {}),
})
console.log(JSON.stringify(transcript, null, 2))
