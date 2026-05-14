import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";

export interface AgentRunResult {
  ok: boolean;
  output: string;
}

export interface AgentRunner {
  name: "claude" | "codex";
  run(opts: { prompt: string; cwd: string; token: string }): Promise<AgentRunResult>;
}

export function getAgent(name: "claude" | "codex"): AgentRunner {
  if (name === "claude") return { name, run: runClaude };
  return { name, run: runCodex };
}
