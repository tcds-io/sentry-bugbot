# sentry-bugbot

GitHub Action that pulls the freshest unresolved Sentry issues for your project and opens one PR per issue containing a fix and a regression test, written by either Claude Code or Codex.

## Usage

```yaml
name: Daily Sentry fixes
on:
  schedule:
    - cron: "0 7 * * *"
  workflow_dispatch:

jobs:
  fix:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: tcds-io/sentry-bugbot@v1
        with:
          agent: claude
          token: ${{ secrets.ANTHROPIC_API_KEY }}
          sentry: |
            token: ${{ secrets.SENTRY_AUTH_TOKEN }}
            org: my-org
            project: my-project
```

## Inputs

| input | required | default | description |
| --- | --- | --- | --- |
| `agent` | yes | — | `claude` or `codex` |
| `token` | yes | — | API key for the selected agent CLI |
| `sentry` | yes | — | YAML block with `token`, `org`, `project`, and optional `url` (defaults to `https://sentry.io`) |
| `maxIssues` | no | `5` | Top-N issues (by event count) attempted per run |
| `baseBranch` | no | repo default | Branch PRs target |
| `githubToken` | no | `${{ github.token }}` | Token for branch push + PR creation |
| `dryRun` | no | `false` | If true, skip push/PR and reset the branch |

### `sentry` block

```yaml
sentry: |
  token: ${{ secrets.SENTRY_AUTH_TOKEN }}   # event:read, project:read, org:read
  org: my-org
  project: my-project
  url: https://sentry.io                    # optional, for self-hosted
```

> GitHub Actions doesn't support nested objects in `with:`, so `sentry` is parsed as a YAML/JSON string inside the action.

## How it works

1. Fetches unresolved Sentry issues from the last 24h, ordered by frequency.
2. For each issue, creates branch `sentry-fix/<short-id>` (idempotent — skipped if branch or open PR already exists).
3. Hands the error (title, stack trace, breadcrumbs, request) to the selected agent CLI with instructions to fix the root cause and add a regression test.
4. Commits the diff and opens a PR linking the Sentry issue.
5. Writes a job summary table mapping each issue to its outcome.

## Development

```bash
npm install
npm run typecheck
npm run build       # bundles to dist/index.js (committed for the action runtime)
```
