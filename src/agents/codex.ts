import * as core from "@actions/core";
import { exec } from "./exec.js";
import type { AgentRunResult } from "./index.js";
import type { Credentials } from "../config.js";

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

export async function runCodex(opts: {
  prompt: string;
  cwd: string;
  credentials: Credentials;
}): Promise<AgentRunResult> {
  await ensureInstalled();
  if (opts.credentials.type !== "api-key") {
    throw new Error(`codex only supports credentials.type 'api-key' (got '${opts.credentials.type}')`);
  }
  const res = await exec(
    "codex",
    ["exec", "--full-auto", opts.prompt],
    {
      cwd: opts.cwd,
      env: { OPENAI_API_KEY: opts.credentials.token },
    },
  );
  return { ok: res.exitCode === 0, output: res.stdout };
}
