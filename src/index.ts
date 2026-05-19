import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "./config.js";
import { SentryClient, type SentryIssue } from "./sentry.js";
import { buildBatchPrompt, parseBatchSummary, type BatchResult } from "./prompt.js";
import { getAgent } from "./agents/index.js";
import { GitRepo } from "./git.js";
import { createPr } from "./pr.js";
import { writeSummary, type Row, type Outcome } from "./summary.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const cwd = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const { owner, repo } = github.context.repo;
  const octokit = github.getOctokit(cfg.githubToken);

  const sentry = new SentryClient(cfg.sentry.url, cfg.sentry.token);
  const agent = getAgent(cfg.agent);
  const git = new GitRepo(cwd);
  await git.configureBot();

  const baseBranch = cfg.baseBranch || (await git.defaultBranch());
  const baseSha = await getBaseSha(git, baseBranch);
  core.info(`Base branch: ${baseBranch} @ ${baseSha}`);

  const issues = await sentry.listIssues(cfg.sentry.org, cfg.sentry.project, cfg.maxIssues);
  core.info(`Fetched ${issues.length} Sentry issues`);

  if (issues.length === 0) {
    await writeSummary([]);
    return;
  }

  const branch = `sentry-fix/batch-${timestamp()}`;
  await git.checkoutNewBranch(branch, baseBranch);

  const items = await Promise.all(
    issues.map(async (issue) => ({ issue, event: await sentry.getLatestEvent(issue.id) })),
  );
  const prompt = buildBatchPrompt(items);

  core.info(`Running ${agent.name} on ${items.length} issue(s) in one session`);
  const result = await agent.run({ prompt, cwd, credentials: cfg.credentials });
  core.info(`Agent finished (ok=${result.ok})`);

  if (!(await git.hasChanges()) && (await git.commitMessagesSince(baseSha)).length === 0) {
    await git.resetHard(baseSha);
    const rows: Row[] = issues.map((i) => ({
      shortId: i.shortId,
      title: i.title,
      permalink: i.permalink,
      outcome: { kind: "skipped", reason: result.ok ? "no changes produced" : "agent failed without changes" },
    }));
    await writeSummary(rows);
    return;
  }

  if (await git.hasChanges()) {
    core.warning("Agent left uncommitted changes; committing as 'fix(sentry): batch leftover changes'");
    await git.commitAll("fix(sentry): batch leftover changes");
  }

  const commitMessages = await git.commitMessagesSince(baseSha);
  const parsed = parseBatchSummary(result.output);
  const outcomesByShortId = buildOutcomeMap(issues, commitMessages, parsed);

  if (cfg.dryRun) {
    await git.resetHard(baseSha);
    const rows: Row[] = issues.map((i) => ({
      shortId: i.shortId,
      title: i.title,
      permalink: i.permalink,
      outcome: { kind: "skipped", reason: "dry-run" },
    }));
    await writeSummary(rows);
    return;
  }

  await git.push(branch);
  const title = `fix(sentry): batch fix for ${issues.length} issue(s)`;
  const body = renderPrBody(items.map((i) => i.issue), outcomesByShortId, result.output);
  const pr = await createPr(octokit, owner, repo, { head: branch, base: baseBranch, title, body });
  core.info(`Opened PR #${pr.number}`);

  const rows: Row[] = issues.map((i) => {
    const local = outcomesByShortId.get(i.shortId);
    const outcome: Outcome =
      local?.kind === "fixed"
        ? { kind: "pr", number: pr.number, url: pr.url }
        : { kind: "skipped", reason: local?.reason ?? "not fixed" };
    return { shortId: i.shortId, title: i.title, permalink: i.permalink, outcome };
  });
  await writeSummary(rows);
}

type LocalOutcome = { kind: "fixed" } | { kind: "skipped"; reason: string };

function buildOutcomeMap(
  issues: SentryIssue[],
  commitMessages: string[],
  parsed: BatchResult[] | null,
): Map<string, LocalOutcome> {
  const map = new Map<string, LocalOutcome>();
  const fixedFromCommits = new Set<string>();
  for (const msg of commitMessages) {
    for (const issue of issues) {
      if (msg.includes(issue.shortId)) fixedFromCommits.add(issue.shortId);
    }
  }
  for (const issue of issues) {
    const parsedRow = parsed?.find((p) => p.shortId === issue.shortId);
    if (fixedFromCommits.has(issue.shortId)) {
      map.set(issue.shortId, { kind: "fixed" });
    } else if (parsedRow?.status === "skipped") {
      map.set(issue.shortId, { kind: "skipped", reason: parsedRow.reason ?? "agent skipped" });
    } else {
      map.set(issue.shortId, { kind: "skipped", reason: "no commit referenced this issue" });
    }
  }
  return map;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function getBaseSha(git: GitRepo, branch: string): Promise<string> {
  try {
    return await git.revparse(`origin/${branch}`);
  } catch {
    return await git.revparse(branch);
  }
}

function renderPrBody(
  issues: SentryIssue[],
  outcomes: Map<string, LocalOutcome>,
  agentOutput: string,
): string {
  const lines: string[] = [];
  lines.push(`Automated batch fix for ${issues.length} Sentry issue(s).`);
  lines.push("");
  lines.push("| Issue | Title | Outcome |");
  lines.push("| --- | --- | --- |");
  for (const issue of issues) {
    const o = outcomes.get(issue.shortId);
    const outcome = o?.kind === "fixed" ? "fixed" : `skipped: ${o?.reason ?? "unknown"}`;
    lines.push(`| [\`${issue.shortId}\`](${issue.permalink}) | ${issue.title.replace(/\|/g, "\\|")} | ${outcome} |`);
  }
  lines.push("");
  lines.push("## Agent summary");
  lines.push("");
  const trimmed = agentOutput.trim();
  const truncated = trimmed.length > 8000 ? `${trimmed.slice(0, 8000)}\n\n…(truncated)` : trimmed;
  lines.push("```");
  lines.push(truncated || "(no output)");
  lines.push("```");
  lines.push("");
  lines.push("_This PR was generated automatically. Please review carefully before merging._");
  return lines.join("\n");
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  core.setFailed(message);
});
