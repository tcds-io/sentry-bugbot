import * as core from "@actions/core";
import { z } from "zod";

const ConfigSchema = z.object({
  agent: z.enum(["claude", "codex"]),
  agentToken: z.string().min(1),
  sentryToken: z.string().min(1),
  sentryOrg: z.string().min(1),
  sentryProject: z.string().min(1),
  sentryUrl: z.string().url(),
  maxIssues: z.number().int().positive().max(50),
  baseBranch: z.string(),
  githubToken: z.string().min(1),
  dryRun: z.boolean(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const raw = {
    agent: core.getInput("agent", { required: true }).toLowerCase(),
    agentToken: core.getInput("agentToken", { required: true }),
    sentryToken: core.getInput("sentryToken", { required: true }),
    sentryOrg: core.getInput("sentryOrg", { required: true }),
    sentryProject: core.getInput("sentryProject", { required: true }),
    sentryUrl: core.getInput("sentryUrl") || "https://sentry.io",
    maxIssues: Number.parseInt(core.getInput("maxIssues") || "5", 10),
    baseBranch: core.getInput("baseBranch") || "",
    githubToken: core.getInput("githubToken", { required: true }),
    dryRun: core.getBooleanInput("dryRun") || false,
  };

  core.setSecret(raw.agentToken);
  core.setSecret(raw.sentryToken);
  core.setSecret(raw.githubToken);

  return ConfigSchema.parse(raw);
}
