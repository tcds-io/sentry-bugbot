import * as core from "@actions/core";

export type Outcome =
  | { kind: "pr"; number: number; url: string }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; message: string };

export interface Row {
  shortId: string;
  title: string;
  permalink: string;
  outcome: Outcome;
}

export async function writeSummary(rows: Row[]): Promise<void> {
  if (rows.length === 0) {
    await core.summary.addHeading("Sentry Errors Fixer").addRaw("No issues found in the last 24h.").write();
    return;
  }
  const table: string[][] = [["Issue", "Title", "Outcome"]];
  for (const r of rows) {
    let outcome: string;
    switch (r.outcome.kind) {
      case "pr":
        outcome = `[PR #${r.outcome.number}](${r.outcome.url})`;
        break;
      case "skipped":
        outcome = `skipped: ${r.outcome.reason}`;
        break;
      case "error":
        outcome = `error: ${r.outcome.message}`;
        break;
    }
    table.push([`[${r.shortId}](${r.permalink})`, r.title, outcome]);
  }
  await core.summary
    .addHeading("Sentry Errors Fixer")
    .addRaw(toMarkdownTable(table))
    .write();
}

function toMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const header = rows[0]!;
  const sep = header.map(() => "---");
  return [header, sep, ...rows.slice(1)].map((r) => `| ${r.join(" | ")} |`).join("\n");
}
