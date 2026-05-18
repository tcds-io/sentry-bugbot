import * as core from "@actions/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const SentrySchema = z.object({
  token: z.string().min(1),
  org: z.string().min(1),
  project: z.string().min(1),
  url: z.string().url().default("https://sentry.io"),
});

const BaseSchema = z.object({
  agent: z.enum(["claude", "codex"]),
  sentry: SentrySchema,
  maxIssues: z.number().int().positive().max(50),
  baseBranch: z.string(),
  githubToken: z.string().min(1),
  dryRun: z.boolean(),
});

export type ClaudeAuth =
  | { kind: "api-key"; value: string }
  | { kind: "oauth-token"; value: string };

export type Config = z.infer<typeof BaseSchema> &
  (
    | { agent: "claude"; claudeAuth: ClaudeAuth; token?: undefined }
    | { agent: "codex"; token: string; claudeAuth?: undefined }
  );

export function loadConfig(): Config {
  const rawSentry = core.getInput("sentry", { required: true });
  let parsedSentry: unknown;
  try {
    parsedSentry = parseYaml(rawSentry);
  } catch (err) {
    throw new Error(`Failed to parse 'sentry' input as YAML/JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const apiKey = core.getInput("token");
  const oauthToken = core.getInput("claudeOauthToken");
  const agent = core.getInput("agent", { required: true }).toLowerCase();

  if (apiKey) core.setSecret(apiKey);
  if (oauthToken) core.setSecret(oauthToken);

  const base = BaseSchema.parse({
    agent,
    sentry: parsedSentry,
    maxIssues: Number.parseInt(core.getInput("maxIssues") || "5", 10),
    baseBranch: core.getInput("baseBranch") || "",
    githubToken: core.getInput("githubToken", { required: true }),
    dryRun: core.getBooleanInput("dryRun") || false,
  });

  core.setSecret(base.githubToken);
  core.setSecret(base.sentry.token);

  if (base.agent === "codex") {
    if (oauthToken) {
      throw new Error("claudeOauthToken is only valid when agent: claude");
    }
    if (!apiKey) {
      throw new Error("token is required when agent: codex");
    }
    return { ...base, agent: "codex", token: apiKey };
  }

  if (apiKey && oauthToken) {
    throw new Error("Provide either token or claudeOauthToken, not both");
  }
  if (!apiKey && !oauthToken) {
    throw new Error("agent: claude requires token or claudeOauthToken");
  }
  const claudeAuth: ClaudeAuth = apiKey
    ? { kind: "api-key", value: apiKey }
    : { kind: "oauth-token", value: oauthToken };
  return { ...base, agent: "claude", claudeAuth };
}
