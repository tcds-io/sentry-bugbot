import type { SentryEvent, SentryIssue } from "./sentry.js";

export const SUMMARY_MARKER = "===SENTRY_FIXER_SUMMARY===";

export function buildBatchPrompt(
  items: { issue: SentryIssue; event: SentryEvent | null }[],
  additionalInstructions = "",
): string {
  const lines: string[] = [];
  lines.push(`# Sentry batch fix: ${items.length} issue(s)`);
  lines.push("");
  lines.push("You are fixing multiple Sentry issues in a single working session on a single branch.");
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  lines.push("1. Work through each issue in order. For each one, investigate the root cause and apply the minimal fix.");
  lines.push("2. After completing the changes for an issue, commit them: `git add -A && git commit -m 'fix(sentry): <SHORTID> <short title>'`. The commit message MUST start with `fix(sentry): <SHORTID>` exactly — the runner parses this.");
  lines.push("3. If two or more issues share a single root cause, fix them with ONE code change and make ONE commit whose message references every affected shortId, e.g. `fix(sentry): PROJ-1 PROJ-2 description`. Do not duplicate fixes.");
  lines.push("4. If you cannot reproduce or fix an issue with confidence, skip it — do not make a commit for it.");
  lines.push("5. Add regression tests where practical. Keep diffs small and focused. Do not refactor unrelated code.");
  lines.push("6. Do NOT push, create PRs, or change branches. The runner handles that.");
  lines.push(`7. When fully done with every issue, print a single line containing exactly: ${SUMMARY_MARKER}`);
  lines.push("   followed by a JSON object on the next line, e.g.:");
  lines.push('   {"results":[{"shortId":"PROJ-1","status":"fixed"},{"shortId":"PROJ-2","status":"skipped","reason":"could not reproduce"}]}');
  lines.push("");
  const extra = additionalInstructions.trim();
  if (extra) {
    lines.push("## Additional project-specific instructions");
    lines.push("");
    lines.push("The repository owner has provided the following instructions. They take precedence over the generic rules above when they conflict (except for rule 6 — never push or open PRs yourself).");
    lines.push("");
    lines.push(extra);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  for (let i = 0; i < items.length; i++) {
    const { issue, event } = items[i]!;
    lines.push(`## Issue ${i + 1}/${items.length}: ${issue.shortId} — ${issue.title}`);
    lines.push("");
    lines.push(`Sentry link: ${issue.permalink}`);
    lines.push(`Event count (24h window): ${issue.count}`);
    if (issue.culprit) lines.push(`Culprit: ${issue.culprit}`);
    lines.push("");
    appendEventDetails(lines, event);
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

function appendEventDetails(lines: string[], event: SentryEvent | null): void {
  if (!event) return;
  if (event.exceptionType || event.exceptionValue) {
    lines.push(`### Exception`);
    lines.push("```");
    lines.push(`${event.exceptionType ?? ""}: ${event.exceptionValue ?? ""}`.trim());
    lines.push("```");
    lines.push("");
  } else if (event.message) {
    lines.push(`### Message`);
    lines.push("```");
    lines.push(event.message);
    lines.push("```");
    lines.push("");
  }

  const inApp = event.frames.filter((f) => f.inApp);
  const frames = (inApp.length > 0 ? inApp : event.frames).slice(-15);
  if (frames.length > 0) {
    lines.push(`### Stack trace (most recent call last)`);
    lines.push("```");
    for (const f of frames) {
      const loc = [f.filename, f.lineno].filter(Boolean).join(":");
      lines.push(`  at ${f.function ?? "<anonymous>"} (${loc || "unknown"})`);
      if (f.contextLine) lines.push(`    | ${f.contextLine.trim()}`);
    }
    lines.push("```");
    lines.push("");
  }

  if (event.breadcrumbs.length > 0) {
    const recent = event.breadcrumbs.slice(-10);
    lines.push(`### Recent breadcrumbs`);
    for (const b of recent) {
      lines.push(`- [${b.level ?? "info"}] ${b.category ?? ""} ${b.message ?? ""}`.trim());
    }
    lines.push("");
  }

  if (event.request?.url) {
    lines.push(`### Request`);
    lines.push(`${event.request.method ?? "GET"} ${event.request.url}`);
    lines.push("");
  }

  if (event.platform) {
    lines.push(`Platform: ${event.platform}`);
    lines.push("");
  }
}

export interface BatchResult {
  shortId: string;
  status: "fixed" | "skipped";
  reason?: string;
}

export function parseBatchSummary(output: string): BatchResult[] | null {
  const idx = output.lastIndexOf(SUMMARY_MARKER);
  if (idx < 0) return null;
  const after = output.slice(idx + SUMMARY_MARKER.length);
  const braceStart = after.indexOf("{");
  if (braceStart < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < after.length; i++) {
    const ch = after[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(after.slice(braceStart, end)) as { results?: BatchResult[] };
    return Array.isArray(parsed.results) ? parsed.results : null;
  } catch {
    return null;
  }
}
