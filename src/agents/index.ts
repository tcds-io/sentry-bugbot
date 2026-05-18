import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";
import type { ClaudeAuth } from "../config.js";

export interface AgentRunResult {
  ok: boolean;
  output: string;
}

export type AgentRunner =
  | {
      name: "claude";
      run(opts: { prompt: string; cwd: string; auth: ClaudeAuth }): Promise<AgentRunResult>;
    }
  | {
      name: "codex";
      run(opts: { prompt: string; cwd: string; token: string }): Promise<AgentRunResult>;
    };

export function getAgent(name: "claude" | "codex"): AgentRunner {
  if (name === "claude") return { name, run: runClaude };
  return { name, run: runCodex };
}
