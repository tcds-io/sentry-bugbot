import * as core from "@actions/core";
import { exec } from "./exec.js";
import type { AgentRunResult } from "./index.js";

let installed = false;

async function ensureInstalled(): Promise<void> {
  if (installed) return;
  core.info("Installing @openai/codex globally");
  const res = await exec("npm", ["install", "-g", "@openai/codex"]);
  if (res.exitCode !== 0) {
    throw new Error(`Failed to install codex CLI: ${res.stderr}`);
  }
  installed = true;
}

export async function runCodex(opts: { prompt: string; cwd: string; token: string }): Promise<AgentRunResult> {
  await ensureInstalled();
  const res = await exec(
    "codex",
    ["exec", "--full-auto", opts.prompt],
    {
      cwd: opts.cwd,
      env: { OPENAI_API_KEY: opts.token },
    },
  );
  return { ok: res.exitCode === 0, output: res.stdout };
}
