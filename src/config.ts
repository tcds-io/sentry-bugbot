import * as core from "@actions/core";
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

const ConfigSchema = z.object({
  agent: z.enum(["claude", "codex"]),
  credentials: CredentialsSchema,
  sentry: SentrySchema,
  maxIssues: z.number().int().positive().max(50),
  baseBranch: z.string(),
  githubToken: z.string().min(1),
  dryRun: z.boolean(),
  additionalInstructions: z.string(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const raw = {
    agent: core.getInput("agent", { required: true }).toLowerCase(),
    credentials: {
      type: core.getInput("credentials-type", { required: true }),
      token: core.getInput("credentials-token", { required: true }),
    },
    sentry: {
      token: core.getInput("sentry-token", { required: true }),
      org: core.getInput("sentry-org", { required: true }),
      project: core.getInput("sentry-project", { required: true }),
      url: core.getInput("sentry-url") || "https://sentry.io",
    },
    maxIssues: Number.parseInt(core.getInput("maxIssues") || "5", 10),
    baseBranch: core.getInput("baseBranch") || "",
    githubToken: core.getInput("githubToken", { required: true }),
    dryRun: core.getBooleanInput("dryRun") || false,
    additionalInstructions: core.getInput("additional-instructions") || "",
  };

  const cfg = ConfigSchema.parse(raw);

  if (cfg.credentials.type === "auth_token" && cfg.agent !== "claude") {
    throw new Error(`credentials-type 'auth_token' is only supported when agent: claude (got agent: ${cfg.agent})`);
  }

  core.setSecret(cfg.credentials.token);
  core.setSecret(cfg.githubToken);
  core.setSecret(cfg.sentry.token);
  return cfg;
}
