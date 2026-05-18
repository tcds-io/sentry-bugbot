import * as core from "@actions/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const SentrySchema = z.object({
  token: z.string().min(1),
  org: z.string().min(1),
  project: z.string().min(1),
  url: z.string().url().default("https://sentry.io"),
});

const CredentialsSchema = z.object({
  type: z.enum(["api-key", "auth_token"]),
  token: z.string().min(1),
});

const BaseSchema = z.object({
  agent: z.enum(["claude", "codex"]),
  credentials: CredentialsSchema,
  sentry: SentrySchema,
  maxIssues: z.number().int().positive().max(50),
  baseBranch: z.string(),
  githubToken: z.string().min(1),
  dryRun: z.boolean(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;
export type Config = z.infer<typeof BaseSchema>;

function parseBlock(name: string, raw: string): unknown {
  try {
    return parseYaml(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse '${name}' input as YAML/JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function loadConfig(): Config {
  const raw = {
    agent: core.getInput("agent", { required: true }).toLowerCase(),
    credentials: parseBlock("credentials", core.getInput("credentials", { required: true })),
    sentry: parseBlock("sentry", core.getInput("sentry", { required: true })),
    maxIssues: Number.parseInt(core.getInput("maxIssues") || "5", 10),
    baseBranch: core.getInput("baseBranch") || "",
    githubToken: core.getInput("githubToken", { required: true }),
    dryRun: core.getBooleanInput("dryRun") || false,
  };

  const cfg = BaseSchema.parse(raw);

  if (cfg.credentials.type === "auth_token" && cfg.agent !== "claude") {
    throw new Error(`credentials.type 'auth_token' is only supported when agent: claude (got agent: ${cfg.agent})`);
  }

  core.setSecret(cfg.credentials.token);
  core.setSecret(cfg.githubToken);
  core.setSecret(cfg.sentry.token);
  return cfg;
}
