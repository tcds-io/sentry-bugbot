# sentry-bugbot

GitHub Action that pulls the freshest unresolved Sentry issues for your project and opens a single PR containing a fix (and where practical a regression test) per issue, written by either Claude Code or Codex.

## Required repository permission

This action pushes a branch and opens a pull request, so the repo must allow GitHub Actions to do both. Enable it once at:

```
https://github.com/<git-org>/<git-project>/settings/actions
```

Under **Workflow permissions**:

- Select **Read and write permissions**.
- Tick **Allow GitHub Actions to create and approve pull requests**.

Without this the action will fail with `GitHub Actions is not permitted to create or approve pull requests` when it tries to open the PR.

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
          max-issues: 5
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
| `max-issues` | no | `5` | Top-N issues (by event count) attempted per run |
| `additional-instructions` | no | `""` | Extra free-form instructions appended to the agent prompt (commit message format, test framework, files to avoid, etc.) |
| `base-branch` | no | repo default | Branch PRs target |
| `github-token` | no | `${{ github.token }}` | Token for branch push + PR creation |
| `dry-run` | no | `false` | If true, skip push/PR and reset the branch |

> The previous camelCase names (`maxIssues`, `baseBranch`, `githubToken`, `dryRun`) are still accepted for backward compatibility but emit a deprecation warning. Migrate to the kebab-case names — the camelCase aliases will be removed in a future release.

### Customizing agent behavior

`additional-instructions` is appended to the prompt the action builds for the agent. Use it for project conventions the agent would not know about:

```yaml
      - uses: tcds-io/sentry-bugbot@v1
        with:
          agent: claude
          credentials-type: api-key
          credentials-token: ${{ secrets.ANTHROPIC_API_KEY }}
          sentry-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: my-org
          sentry-project: my-project
          additional-instructions: |
            Use this commit format: SENTRY-{sentry-project}: {title}\n\n{description}
            Tests live in tests/ and use vitest.
            Never touch files under generated/.
```

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

1. Fetches up to `max-issues` unresolved Sentry issues from the last 24h, ordered by frequency.
2. Creates a single batch branch `sentry-fix/batch-<utc-timestamp>`.
3. Hands every issue (title, stack trace, breadcrumbs, request) to the selected agent CLI in **one session**, with instructions to fix each root cause, add a regression test where practical, and commit per fix using `fix(sentry): <SHORTID> <title>`. Issues sharing a root cause are coalesced into a single commit referencing every affected shortId, which eliminates duplicate fixes on related errors.
4. Pushes the branch and opens one PR listing every issue and its outcome.
5. Writes a job summary table mapping each issue to its outcome.

## Development

```bash
npm install
npm run typecheck
npm run build       # bundles to dist/index.cjs (committed for the action runtime)
```
