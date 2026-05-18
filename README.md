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
          credentials: |
            type: api-key
            token: ${{ secrets.ANTHROPIC_API_KEY }}
          sentry: |
            token: ${{ secrets.SENTRY_AUTH_TOKEN }}
            org: my-org
            project: my-project
```

Or, with a Claude Pro/Max subscription via OAuth token:

```yaml
      - uses: tcds-io/sentry-bugbot@v1
        with:
          agent: claude
          credentials: |
            type: auth_token
            token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          sentry: |
            token: ${{ secrets.SENTRY_AUTH_TOKEN }}
            org: my-org
            project: my-project
```

## Inputs

| input | required | default | description |
| --- | --- | --- | --- |
| `agent` | yes | — | `claude` or `codex` |
| `credentials` | yes | — | YAML block with `type` (`api-key` or `auth_token`) and `token`. See [credentials block](#credentials-block) below. |
| `sentry` | yes | — | YAML block with `token`, `org`, `project`, and optional `url` (defaults to `https://sentry.io`) |
| `maxIssues` | no | `5` | Top-N issues (by event count) attempted per run |
| `baseBranch` | no | repo default | Branch PRs target |
| `githubToken` | no | `${{ github.token }}` | Token for branch push + PR creation |
| `dryRun` | no | `false` | If true, skip push/PR and reset the branch |

### `credentials` block

```yaml
credentials: |
  type: api-key      # or "auth_token" (claude only)
  token: ${{ secrets.ANTHROPIC_API_KEY }}
```

- `type: api-key` — `token` is set as `ANTHROPIC_API_KEY` (claude) or `OPENAI_API_KEY` (codex). Billed via the provider's standard API.
- `type: auth_token` — `token` is set as `CLAUDE_CODE_OAUTH_TOKEN` and binds the run to a Claude Pro/Max subscription. Only supported when `agent: claude`.

### `sentry` block

```yaml
sentry: |
  token: ${{ secrets.SENTRY_AUTH_TOKEN }}   # event:read, project:read, org:read
  org: my-org
  project: my-project
  url: https://sentry.io                    # optional, for self-hosted
```

> GitHub Actions doesn't support nested objects in `with:`, so structured inputs are parsed as YAML/JSON strings inside the action.

## Using a Claude Pro/Max subscription

Instead of paying per-token via the Anthropic API, you can bind the run to a Claude Pro/Max subscription using an OAuth token.

1. Run `claude setup-token` locally to produce a long-lived OAuth token tied to your subscription.
2. Store it as a GitHub secret (e.g. `CLAUDE_CODE_OAUTH_TOKEN`).
3. Pass it via `credentials: { type: auth_token, token: ... }`.

Caveats:

- The token authenticates the human who generated it. Every run consumes that user's subscription quota and shows up in their Anthropic usage.
- Subscription rate limits are enforced per 5-hour window — a noisy day can exhaust the budget for other tools that share the same account.
- Rotation is manual: re-run `claude setup-token` and update the secret.
- Codex has no equivalent env-var-based OAuth flow, so `type: auth_token` is rejected when `agent: codex`.

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
