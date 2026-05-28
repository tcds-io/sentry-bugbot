import type { SentryEvent, SentryIssue } from "./sentry.js";

export const SUMMARY_MARKER = "===SENTRY_FIXER_SUMMARY===";

export function noteRelativePath(project: string, shortId: string): string {
  return `.bugbot/${project}/${shortId}.md`;
}

export function buildBatchPrompt(
  items: { issue: SentryIssue; event: SentryEvent | null; priorNote?: string | null }[],
  additionalInstructions = "",
  project = "",
): string {
  const lines: string[] = [];
  lines.push(`# Sentry batch fix: ${items.length} issue(s)`);
  lines.push("");
  lines.push("You are fixing multiple Sentry issues in a single working session on a single branch.");
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  lines.push("1. Work through each issue in order. For each one, investigate the root cause first.");
  lines.push("2. Before writing any code, decide whether a real fix is warranted. A fix is only worth applying when it addresses the ROOT CAUSE. Do NOT apply a code change — instead DEFER — when either is true:");
  lines.push("   - **Noise-only fix:** the change would merely silence the Sentry error rather than fix the underlying problem (e.g. swallowing/broadening a catch, adding a blanket null/optional guard that hides a deeper bug, wrapping in try/except, lowering a log level, filtering the event). Suppressing the symptom is NOT a fix.");
  lines.push("   - **Risk too high:** a correct fix would touch critical paths, have a broad blast radius, change behaviour in ways you cannot verify, or you are not confident it is correct.");
  lines.push("   When you defer, write the note (rule 3) with a clear recommendation for what a safe real fix would require, make NO code change, and mark the issue `deferred` in the summary.");
  lines.push(`3. For EVERY issue you investigate — fixed, deferred, or skipped — write your analysis to \`.bugbot/${project || "<project>"}/<SHORTID>.md\` with exactly these three sections:`);
  lines.push("   - `## Findings` — why this bug happens and the relevant context (code paths, inputs, environment).");
  lines.push("   - `## Proposed solution` — how you approached the fix and why it resolves the root cause. If deferred, state that the fix is deferred, WHY (noise-only or risk too high), and what a safe real fix would require. If skipped, explain what you tried and why you could not locate/reproduce it.");
  lines.push("   - `## Risks` — what could go wrong if this patch ships (edge cases, behavioral changes, areas needing extra review).");
  lines.push("   If a prior note already exists for the issue (it will be shown below under \"Prior bugbot note\"), refine and update it rather than discarding its history.");
  lines.push("4. Commit the note together with the code fix for that issue: `git add -A && git commit -m 'fix(sentry): <SHORTID> <short title>'`. The commit message MUST start with `fix(sentry): <SHORTID>` exactly — the runner uses that prefix to tell a real fix from a notes-only commit. For a deferred or skipped issue, commit ONLY the note with `docs(bugbot): <SHORTID> investigation notes` — never use the `fix(sentry):` prefix when you did not change code.");
  lines.push("5. If two or more issues share a single root cause, fix them with ONE code change and make ONE commit whose message references every affected shortId, e.g. `fix(sentry): PROJ-1 PROJ-2 description`. Still write a note file for each affected shortId. Do not duplicate fixes.");
  lines.push("6. If you cannot reproduce or locate an issue with confidence, skip it (status `skipped`); still write its note per rule 3.");
  lines.push("7. Add regression tests where practical. Keep diffs small and focused. Do not refactor unrelated code.");
  lines.push("8. Do NOT push, create PRs, or change branches. The runner handles that.");
  lines.push(`9. When fully done with every issue, print a single line containing exactly: ${SUMMARY_MARKER}`);
  lines.push("   followed by a JSON object on the next line. `status` is one of `fixed`, `deferred`, or `skipped`; include a `reason` for deferred and skipped. Example:");
  lines.push('   {"results":[{"shortId":"PROJ-1","status":"fixed"},{"shortId":"PROJ-2","status":"deferred","reason":"noise-only: a real fix needs a schema migration"},{"shortId":"PROJ-3","status":"skipped","reason":"could not reproduce"}]}');
  lines.push("");
  const extra = additionalInstructions.trim();
  if (extra) {
    lines.push("## Additional project-specific instructions");
    lines.push("");
    lines.push("The repository owner has provided the following instructions. They take precedence over the generic rules above when they conflict (except for rule 8 — never push or open PRs yourself).");
    lines.push("");
    lines.push(extra);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  for (let i = 0; i < items.length; i++) {
    const { issue, event, priorNote } = items[i]!;
    lines.push(`## Issue ${i + 1}/${items.length}: ${issue.shortId} — ${issue.title}`);
    lines.push("");
    lines.push(`Sentry link: ${issue.permalink}`);
    lines.push(`Event count (24h window): ${issue.count}`);
    if (issue.culprit) lines.push(`Culprit: ${issue.culprit}`);
    lines.push(`Note file to write/update: \`${noteRelativePath(project || "<project>", issue.shortId)}\``);
    lines.push("");
    appendEventDetails(lines, event);
    if (priorNote && priorNote.trim()) {
      lines.push(`### Prior bugbot note (${noteRelativePath(project || "<project>", issue.shortId)})`);
      lines.push("");
      lines.push("This issue was investigated in an earlier run. Build on this; do not start from scratch.");
      lines.push("");
      lines.push("```markdown");
      lines.push(priorNote.trim());
      lines.push("```");
      lines.push("");
    }
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
  status: "fixed" | "deferred" | "skipped";
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
