import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "./config.js";
import { SentryClient, type SentryEvent, type SentryIssue } from "./sentry.js";
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
  const prompt = buildBatchPrompt(items, cfg.additionalInstructions);

  core.info(`Running ${agent.name} on ${items.length} issue(s) in one session`);
  const result = await agent.run({ prompt, cwd, credentials: cfg.credentials });
  core.info(`Agent finished (ok=${result.ok})`);

  if (!(await git.hasChanges()) && (await git.commitsSince(baseSha)).length === 0) {
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

  const commits = await git.commitsSince(baseSha);
  const parsed = parseBatchSummary(result.output);
  const outcomesByShortId = buildOutcomeMap(issues, commits, parsed);
  const fixGroups = buildFixGroups(issues, commits);

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
  const body = renderPrBody(items, outcomesByShortId, fixGroups, result.output);
  const pr = await createPr(octokit, owner, repo, { head: branch, base: baseBranch, title, body });
  core.info(`Opened PR #${pr.number}`);

  await annotateSentryIssues(sentry, issues, outcomesByShortId, pr);

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

type Commit = { hash: string; message: string };
type LocalOutcome =
  | { kind: "fixed"; commits: Commit[]; coFixedShortIds: string[] }
  | { kind: "skipped"; reason: string };

interface FixGroup {
  commit: Commit;
  shortIds: string[];
}

function buildOutcomeMap(
  issues: SentryIssue[],
  commits: Commit[],
  parsed: BatchResult[] | null,
): Map<string, LocalOutcome> {
  const commitsByShortId = new Map<string, Commit[]>();
  for (const commit of commits) {
    for (const issue of issues) {
      if (commit.message.includes(issue.shortId)) {
        const list = commitsByShortId.get(issue.shortId) ?? [];
        list.push(commit);
        commitsByShortId.set(issue.shortId, list);
      }
    }
  }

  const map = new Map<string, LocalOutcome>();
  for (const issue of issues) {
    const matched = commitsByShortId.get(issue.shortId) ?? [];
    if (matched.length > 0) {
      const coFixed = new Set<string>();
      for (const commit of matched) {
        for (const peer of issues) {
          if (peer.shortId !== issue.shortId && commit.message.includes(peer.shortId)) {
            coFixed.add(peer.shortId);
          }
        }
      }
      map.set(issue.shortId, {
        kind: "fixed",
        commits: matched,
        coFixedShortIds: [...coFixed],
      });
      continue;
    }
    const parsedRow = parsed?.find((p) => p.shortId === issue.shortId);
    if (parsedRow?.status === "skipped") {
      map.set(issue.shortId, { kind: "skipped", reason: parsedRow.reason ?? "agent skipped" });
    } else {
      map.set(issue.shortId, { kind: "skipped", reason: "no commit referenced this issue" });
    }
  }
  return map;
}

function buildFixGroups(issues: SentryIssue[], commits: Commit[]): FixGroup[] {
  const groups: FixGroup[] = [];
  for (const commit of commits) {
    const shortIds = issues.filter((i) => commit.message.includes(i.shortId)).map((i) => i.shortId);
    if (shortIds.length > 0) groups.push({ commit, shortIds });
  }
  return groups;
}

async function annotateSentryIssues(
  sentry: SentryClient,
  issues: SentryIssue[],
  outcomes: Map<string, LocalOutcome>,
  pr: { number: number; url: string },
): Promise<void> {
  let any403 = false;
  for (const issue of issues) {
    const o = outcomes.get(issue.shortId);
    if (o?.kind !== "fixed") continue;
    const shaList = o.commits.map((c) => c.hash.slice(0, 7)).join(", ");
    const coFixed = o.coFixedShortIds.length > 0 ? ` (co-fixed with ${o.coFixedShortIds.join(", ")})` : "";
    const text = `🤖 sentry-bugbot opened PR ${pr.url} to fix this issue${coFixed}. Fix commit(s): ${shaList}.`;
    const ok = await sentry.addIssueComment(issue.id, text);
    if (!ok) any403 = true;
  }
  if (any403) {
    core.warning(
      "Could not post sentry-bugbot back-link to one or more Sentry issues. The token likely lacks the `event:write` scope. See README -> Sentry token.",
    );
  }
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
  items: { issue: SentryIssue; event: SentryEvent | null }[],
  outcomes: Map<string, LocalOutcome>,
  fixGroups: FixGroup[],
  agentOutput: string,
): string {
  const lines: string[] = [];
  const fixedCount = [...outcomes.values()].filter((o) => o.kind === "fixed").length;
  lines.push(`Automated batch fix: ${fixedCount} of ${items.length} Sentry issue(s) addressed across ${fixGroups.length} commit(s).`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push("| Issue | Title | Outcome | Commit |");
  lines.push("| --- | --- | --- | --- |");
  for (const { issue } of items) {
    const o = outcomes.get(issue.shortId);
    const outcome = o?.kind === "fixed" ? "fixed" : `skipped: ${o?.reason ?? "unknown"}`;
    const commitCell =
      o?.kind === "fixed" ? o.commits.map((c) => `\`${c.hash.slice(0, 7)}\``).join(", ") : "—";
    lines.push(
      `| [\`${issue.shortId}\`](${issue.permalink}) | ${escapeCell(issue.title)} | ${outcome} | ${commitCell} |`,
    );
  }
  lines.push("");
  if (fixGroups.length > 0) {
    lines.push("## Fixes (grouped by commit)");
    lines.push("");
    lines.push("Issues sharing a root cause are fixed by a single commit referencing every affected shortId:");
    lines.push("");
    for (const group of fixGroups) {
      const subject = group.commit.message.split("\n")[0] ?? "";
      const ids = group.shortIds.map((id) => `\`${id}\``).join(", ");
      lines.push(`- \`${group.commit.hash.slice(0, 7)}\` — ${ids}: ${escapeCell(subject)}`);
    }
    lines.push("");
  }
  lines.push("## Issue details");
  lines.push("");
  for (const { issue, event } of items) {
    const o = outcomes.get(issue.shortId);
    const outcome = o?.kind === "fixed" ? "**fixed**" : `**skipped** — ${o?.reason ?? "unknown"}`;
    lines.push(`### [\`${issue.shortId}\`](${issue.permalink}) ${issue.title}`);
    lines.push("");
    lines.push(`- Sentry: ${issue.permalink}`);
    lines.push(`- Outcome: ${outcome}`);
    if (o?.kind === "fixed") {
      const shas = o.commits.map((c) => `\`${c.hash.slice(0, 7)}\``).join(", ");
      lines.push(`- Fix commit(s): ${shas}`);
      if (o.coFixedShortIds.length > 0) {
        const peers = o.coFixedShortIds.map((id) => `\`${id}\``).join(", ");
        lines.push(`- Co-fixed with: ${peers} (shared root cause)`);
      }
    }
    lines.push(`- Event count (24h): ${issue.count}`);
    if (issue.culprit) lines.push(`- Culprit: \`${issue.culprit}\``);
    if (event?.platform) lines.push(`- Platform: ${event.platform}`);
    if (event?.request?.url) lines.push(`- Request: \`${event.request.method ?? "GET"} ${event.request.url}\``);
    lines.push("");
    if (event?.exceptionType || event?.exceptionValue) {
      lines.push("Exception:");
      lines.push("");
      lines.push("```");
      lines.push(`${event.exceptionType ?? ""}: ${event.exceptionValue ?? ""}`.trim());
      lines.push("```");
      lines.push("");
    } else if (event?.message) {
      lines.push("Message:");
      lines.push("");
      lines.push("```");
      lines.push(event.message);
      lines.push("```");
      lines.push("");
    }
    if (event && event.frames.length > 0) {
      const inApp = event.frames.filter((f) => f.inApp);
      const frames = (inApp.length > 0 ? inApp : event.frames).slice(-8);
      lines.push("<details><summary>Stack trace (top 8 frames, most recent last)</summary>");
      lines.push("");
      lines.push("```");
      for (const f of frames) {
        const loc = [f.filename, f.lineno].filter(Boolean).join(":");
        lines.push(`  at ${f.function ?? "<anonymous>"} (${loc || "unknown"})`);
        if (f.contextLine) lines.push(`    | ${f.contextLine.trim()}`);
      }
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }
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

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  core.setFailed(message);
});
