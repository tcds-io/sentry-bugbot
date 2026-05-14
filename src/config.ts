import * as core from "@actions/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const SentrySchema = z.object({
  token: z.string().min(1),
  org: z.string().min(1),
  project: z.string().min(1),
  url: z.string().url().default("https://sentry.io"),
});

const ConfigSchema = z.object({
  agent: z.enum(["claude", "codex"]),
  token: z.string().min(1),
  sentry: SentrySchema,
  maxIssues: z.number().int().positive().max(50),
  baseBranch: z.string(),
  githubToken: z.string().min(1),
  dryRun: z.boolean(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const rawSentry = core.getInput("sentry", { required: true });
  let parsedSentry: unknown;
  try {
    parsedSentry = parseYaml(rawSentry);
  } catch (err) {
    throw new Error(`Failed to parse 'sentry' input as YAML/JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const raw = {
    agent: core.getInput("agent", { required: true }).toLowerCase(),
    token: core.getInput("token", { required: true }),
    sentry: parsedSentry,
    maxIssues: Number.parseInt(core.getInput("maxIssues") || "5", 10),
    baseBranch: core.getInput("baseBranch") || "",
    githubToken: core.getInput("githubToken", { required: true }),
    dryRun: core.getBooleanInput("dryRun") || false,
  };

  core.setSecret(raw.token);
  core.setSecret(raw.githubToken);

  const cfg = ConfigSchema.parse(raw);
  core.setSecret(cfg.sentry.token);
  return cfg;
}
