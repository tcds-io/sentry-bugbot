import * as github from "@actions/github";

type Octokit = ReturnType<typeof github.getOctokit>;

export interface PrInfo {
  number: number;
  url: string;
}

export async function findOpenPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  head: string,
): Promise<PrInfo | null> {
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    head: `${owner}:${head}`,
    per_page: 1,
  });
  const pr = data[0];
  return pr ? { number: pr.number, url: pr.html_url } : null;
}

export async function createPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  opts: { head: string; base: string; title: string; body: string },
): Promise<PrInfo> {
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    head: opts.head,
    base: opts.base,
    title: opts.title,
    body: opts.body,
  });
  return { number: data.number, url: data.html_url };
}
