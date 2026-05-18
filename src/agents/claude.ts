import * as core from "@actions/core";
import { exec } from "./exec.js";
import type { AgentRunResult } from "./index.js";
import type { ClaudeAuth } from "../config.js";

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

export async function runClaude(opts: { prompt: string; cwd: string; auth: ClaudeAuth }): Promise<AgentRunResult> {
  await ensureInstalled();
  const env =
    opts.auth.kind === "api-key"
      ? { ANTHROPIC_API_KEY: opts.auth.value }
      : { CLAUDE_CODE_OAUTH_TOKEN: opts.auth.value };
  const res = await exec(
    "claude",
    ["-p", opts.prompt, "--permission-mode", "acceptEdits"],
    {
      cwd: opts.cwd,
      env,
    },
  );
  return { ok: res.exitCode === 0, output: res.stdout };
}
