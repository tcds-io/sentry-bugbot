import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "./config.js";
import { SentryClient, type SentryIssue } from "./sentry.js";
import { buildPrompt } from "./prompt.js";
import { getAgent } from "./agents/index.js";
import { GitRepo } from "./git.js";
import { createPr, findOpenPr } from "./pr.js";
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

  const rows: Row[] = [];
  for (const issue of issues) {
    const row: Row = { shortId: issue.shortId, title: issue.title, permalink: issue.permalink, outcome: { kind: "skipped", reason: "" } };
    try {
      row.outcome = await processIssue({
        issue,
        baseBranch,
        baseSha,
        cwd,
        cfg,
        sentry,
        agent,
        git,
        octokit,
        owner,
        repo,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      core.error(`Issue ${issue.shortId} failed: ${message}`);
      row.outcome = { kind: "error", message };
      await git.resetHard(baseSha).catch(() => {});
    }
    rows.push(row);
  }

  await writeSummary(rows);
}

async function processIssue(args: {
  issue: SentryIssue;
  baseBranch: string;
  baseSha: string;
  cwd: string;
  cfg: ReturnType<typeof loadConfig>;
  sentry: SentryClient;
  agent: ReturnType<typeof getAgent>;
  git: GitRepo;
  octokit: ReturnType<typeof github.getOctokit>;
  owner: string;
  repo: string;
}): Promise<Outcome> {
  const { issue, baseBranch, baseSha, cwd, cfg, sentry, agent, git, octokit, owner, repo } = args;
  const branch = `sentry-fix/${issue.shortId.toLowerCase()}`;

  if (await git.remoteBranchExists(branch)) {
    const existing = await findOpenPr(octokit, owner, repo, branch);
    if (existing) {
      return { kind: "skipped", reason: `existing PR #${existing.number}` };
    }
    return { kind: "skipped", reason: "branch already exists on remote" };
  }

  await git.checkoutNewBranch(branch, baseBranch);

  const event = await sentry.getLatestEvent(issue.id);
  const prompt = buildPrompt(issue, event);
  core.info(`Running ${agent.name} for ${issue.shortId}`);
  const result = await agent.run({ prompt, cwd, credentials: cfg.credentials });

  if (!(await git.hasChanges())) {
    await git.resetHard(baseSha);
    return { kind: "skipped", reason: result.ok ? "no changes produced" : "agent failed without changes" };
  }

  const commitMsg = `fix(sentry): ${issue.shortId} ${issue.title}`.slice(0, 200);
  await git.commitAll(commitMsg);

  if (cfg.dryRun) {
    await git.resetHard(baseSha);
    return { kind: "skipped", reason: "dry-run" };
  }

  await git.push(branch);
  const body = renderPrBody(issue, result.output);
  const pr = await createPr(octokit, owner, repo, {
    head: branch,
    base: baseBranch,
    title: commitMsg,
    body,
  });
  return { kind: "pr", number: pr.number, url: pr.url };
}

async function getBaseSha(git: GitRepo, branch: string): Promise<string> {
  try {
    return await git.revparse(`origin/${branch}`);
  } catch {
    return await git.revparse(branch);
  }
}

function renderPrBody(issue: SentryIssue, agentOutput: string): string {
  const trimmed = agentOutput.trim();
  const truncated = trimmed.length > 8000 ? `${trimmed.slice(0, 8000)}\n\n…(truncated)` : trimmed;
  return [
    `Automated fix for Sentry issue [\`${issue.shortId}\`](${issue.permalink}).`,
    "",
    `**Title:** ${issue.title}`,
    issue.culprit ? `**Culprit:** \`${issue.culprit}\`` : null,
    `**Event count (24h):** ${issue.count}`,
    "",
    "## Agent summary",
    "",
    "```",
    truncated || "(no output)",
    "```",
    "",
    "_This PR was generated automatically. Please review carefully before merging._",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  core.setFailed(message);
});
