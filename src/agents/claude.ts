import * as core from "@actions/core";
import { exec } from "./exec.js";
import type { AgentRunResult } from "./index.js";

let installed = false;

async function ensureInstalled(): Promise<void> {
  if (installed) return;
  core.info("Installing @anthropic-ai/claude-code globally");
  const res = await exec("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
  if (res.exitCode !== 0) {
    throw new Error(`Failed to install claude CLI: ${res.stderr}`);
  }
  installed = true;
}

export async function runClaude(opts: { prompt: string; cwd: string; token: string }): Promise<AgentRunResult> {
  await ensureInstalled();
  const res = await exec(
    "claude",
    ["-p", opts.prompt, "--permission-mode", "acceptEdits"],
    {
      cwd: opts.cwd,
      env: { ANTHROPIC_API_KEY: opts.token },
    },
  );
  return { ok: res.exitCode === 0, output: res.stdout };
}
