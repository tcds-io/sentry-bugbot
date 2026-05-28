import * as core from "@actions/core";
import { exec } from "./exec.js";
import type { AgentRunResult } from "./index.js";
import type { Credentials } from "../config.js";

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

export async function runClaude(opts: {
  prompt: string;
  cwd: string;
  credentials: Credentials;
}): Promise<AgentRunResult> {
  await ensureInstalled();
  const env =
    opts.credentials.type === "api-key"
      ? { ANTHROPIC_API_KEY: opts.credentials.token }
      : { CLAUDE_CODE_OAUTH_TOKEN: opts.credentials.token };
  // Runs in an ephemeral CI runner with no human to approve prompts. `acceptEdits`
  // only auto-approves file edits, so Bash steps the prompt relies on (git add /
  // git commit) would hang or be denied. Bypass permissions entirely for the
  // headless run; the runner is sandboxed and discarded after the job.
  const res = await exec(
    "claude",
    ["-p", opts.prompt, "--dangerously-skip-permissions"],
    {
      cwd: opts.cwd,
      env,
    },
  );
  return { ok: res.exitCode === 0, output: res.stdout };
}
