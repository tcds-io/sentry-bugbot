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
          credentials-type: api-key
          credentials-token: ${{ secrets.ANTHROPIC_API_KEY }}
          sentry-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: my-org
          sentry-project: my-project
```

Or, with a Claude Pro/Max subscription via OAuth token:

```yaml
      - uses: tcds-io/sentry-bugbot@v1
        with:
          agent: claude
          credentials-type: auth_token
          credentials-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          sentry-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: my-org
          sentry-project: my-project
          sentry-url: https://de.sentry.io     # optional, for self-hosted / region
```

## Inputs

| input | required | default | description |
| --- | --- | --- | --- |
| `agent` | yes | — | `claude` or `codex` |
| `credentials-type` | yes | — | `api-key` or `auth_token`. `auth_token` is only valid when `agent: claude`. |
| `credentials-token` | yes | — | API key or OAuth token for the selected agent. |
| `sentry-token` | yes | — | Sentry auth token (`event:read`, `project:read`, `org:read`). |
| `sentry-org` | yes | — | Sentry organization slug. |
| `sentry-project` | yes | — | Sentry project slug. |
| `sentry-url` | no | `https://sentry.io` | Sentry base URL (for self-hosted or regional). |
| `maxIssues` | no | `5` | Top-N issues (by event count) attempted per run |
| `baseBranch` | no | repo default | Branch PRs target |
| `githubToken` | no | `${{ github.token }}` | Token for branch push + PR creation |
| `dryRun` | no | `false` | If true, skip push/PR and reset the branch |

### Credentials

- `credentials-type: api-key` — `credentials-token` is set as `ANTHROPIC_API_KEY` (claude) or `OPENAI_API_KEY` (codex). Billed via the provider's standard API.
- `credentials-type: auth_token` — `credentials-token` is set as `CLAUDE_CODE_OAUTH_TOKEN` and binds the run to a Claude Pro/Max subscription. Only supported when `agent: claude`.

## Using a Claude Pro/Max subscription

Instead of paying per-token via the Anthropic API, you can bind the run to a Claude Pro/Max subscription using an OAuth token.

1. Run `claude setup-token` locally to produce a long-lived OAuth token tied to your subscription.
2. Store it as a GitHub secret (e.g. `CLAUDE_CODE_OAUTH_TOKEN`).
3. Pass `credentials-type: auth_token` and `credentials-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.

Caveats:

- The token authenticates the human who generated it. Every run consumes that user's subscription quota and shows up in their Anthropic usage.
- Subscription rate limits are enforced per 5-hour window — a noisy day can exhaust the budget for other tools that share the same account.
- Rotation is manual: re-run `claude setup-token` and update the secret.
- Codex has no equivalent env-var-based OAuth flow, so `auth_token` is rejected when `agent: codex`.

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
npm run build       # bundles to dist/index.cjs (committed for the action runtime)
```
