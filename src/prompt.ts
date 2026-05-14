import type { SentryEvent, SentryIssue } from "./sentry.js";

export function buildPrompt(issue: SentryIssue, event: SentryEvent | null): string {
  const lines: string[] = [];
  lines.push(`# Sentry issue ${issue.shortId}: ${issue.title}`);
  lines.push("");
  lines.push(`Sentry link: ${issue.permalink}`);
  lines.push(`Event count (24h window): ${issue.count}`);
  if (issue.culprit) lines.push(`Culprit: ${issue.culprit}`);
  lines.push("");

  if (event) {
    if (event.exceptionType || event.exceptionValue) {
      lines.push(`## Exception`);
      lines.push("```");
      lines.push(`${event.exceptionType ?? ""}: ${event.exceptionValue ?? ""}`.trim());
      lines.push("```");
      lines.push("");
    } else if (event.message) {
      lines.push(`## Message`);
      lines.push("```");
      lines.push(event.message);
      lines.push("```");
      lines.push("");
    }

    const inApp = event.frames.filter((f) => f.inApp);
    const frames = (inApp.length > 0 ? inApp : event.frames).slice(-15);
    if (frames.length > 0) {
      lines.push(`## Stack trace (most recent call last)`);
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
      lines.push(`## Recent breadcrumbs`);
      for (const b of recent) {
        lines.push(`- [${b.level ?? "info"}] ${b.category ?? ""} ${b.message ?? ""}`.trim());
      }
      lines.push("");
    }

    if (event.request?.url) {
      lines.push(`## Request`);
      lines.push(`${event.request.method ?? "GET"} ${event.request.url}`);
      lines.push("");
    }

    if (event.platform) {
      lines.push(`Platform: ${event.platform}`);
      lines.push("");
    }
  }

  lines.push(`## Your task`);
  lines.push("");
  lines.push("1. Investigate the root cause of this Sentry error in this repository.");
  lines.push("2. Implement the minimal fix necessary. Do not refactor unrelated code.");
  lines.push("3. Add a regression test that fails without your fix and passes with it.");
  lines.push("4. Keep the diff small and focused. Do not touch unrelated files.");
  lines.push("5. If you cannot reproduce or locate the issue with confidence, make NO changes and explain why.");
  lines.push("");
  lines.push("When done, print a short summary of the root cause and the change you made.");
  return lines.join("\n");
}
