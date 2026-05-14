import * as core from "@actions/core";

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  permalink: string;
  count: string;
  metadata: Record<string, unknown>;
}

export interface SentryFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  contextLine?: string;
  inApp?: boolean;
  preContext?: string[];
  postContext?: string[];
}

export interface SentryEvent {
  id: string;
  platform: string | null;
  message: string | null;
  exceptionType: string | null;
  exceptionValue: string | null;
  frames: SentryFrame[];
  breadcrumbs: { category?: string; message?: string; level?: string; timestamp?: string }[];
  request: { url?: string; method?: string } | null;
  tags: Record<string, string>;
}

export class SentryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async listIssues(org: string, project: string, limit: number): Promise<SentryIssue[]> {
    const url = new URL(`/api/0/projects/${org}/${project}/issues/`, this.baseUrl);
    url.searchParams.set("query", "is:unresolved age:-24h");
    url.searchParams.set("sort", "freq");
    url.searchParams.set("limit", String(limit));

    const res = await this.fetch(url);
    const data = (await res.json()) as Array<{
      id: string;
      shortId: string;
      title: string;
      culprit: string | null;
      permalink: string;
      count: string;
      metadata: Record<string, unknown>;
    }>;

    return data.map((i) => ({
      id: i.id,
      shortId: i.shortId,
      title: i.title,
      culprit: i.culprit,
      permalink: i.permalink,
      count: i.count,
      metadata: i.metadata,
    }));
  }

  async getLatestEvent(issueId: string): Promise<SentryEvent | null> {
    const url = new URL(`/api/0/issues/${issueId}/events/latest/`, this.baseUrl);
    const res = await this.fetchAllow404(url);
    if (!res) return null;
    const data = (await res.json()) as RawEvent;

    const exceptionEntry = data.entries?.find((e) => e.type === "exception");
    const breadcrumbsEntry = data.entries?.find((e) => e.type === "breadcrumbs");
    const requestEntry = data.entries?.find((e) => e.type === "request");

    const firstException = exceptionEntry?.data?.values?.[0];
    const frames = (firstException?.stacktrace?.frames ?? []).map<SentryFrame>((f) => ({
      filename: f.filename ?? undefined,
      function: f.function ?? undefined,
      lineno: f.lineNo ?? f.lineno ?? undefined,
      colno: f.colNo ?? f.colno ?? undefined,
      contextLine: f.context_line ?? undefined,
      inApp: f.inApp ?? undefined,
      preContext: f.pre_context ?? undefined,
      postContext: f.post_context ?? undefined,
    }));

    const tags: Record<string, string> = {};
    for (const t of data.tags ?? []) {
      if (t?.key && t?.value) tags[t.key] = t.value;
    }

    return {
      id: data.id,
      platform: data.platform ?? null,
      message: data.message ?? null,
      exceptionType: firstException?.type ?? null,
      exceptionValue: firstException?.value ?? null,
      frames,
      breadcrumbs: (breadcrumbsEntry?.data?.values ?? []).map((b) => ({
        category: b.category,
        message: b.message,
        level: b.level,
        timestamp: b.timestamp,
      })),
      request: requestEntry?.data ? { url: requestEntry.data.url, method: requestEntry.data.method } : null,
      tags,
    };
  }

  private async fetch(url: URL): Promise<Response> {
    const res = await this.rawFetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Sentry API ${res.status} ${res.statusText} for ${url.pathname}: ${body.slice(0, 200)}`);
    }
    return res;
  }

  private async fetchAllow404(url: URL): Promise<Response | null> {
    const res = await this.rawFetch(url);
    if (res.status === 404) {
      core.warning(`Sentry 404 for ${url.pathname}`);
      return null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Sentry API ${res.status} ${res.statusText} for ${url.pathname}: ${body.slice(0, 200)}`);
    }
    return res;
  }

  private rawFetch(url: URL): Promise<Response> {
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });
  }
}

interface RawEntry {
  type: string;
  data: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: { frames?: RawFrame[] };
      category?: string;
      message?: string;
      level?: string;
      timestamp?: string;
    }>;
    url?: string;
    method?: string;
  };
}

interface RawEvent {
  id: string;
  platform?: string;
  message?: string;
  entries?: RawEntry[];
  tags?: Array<{ key: string; value: string }>;
}

interface RawFrame {
  filename?: string;
  function?: string;
  lineNo?: number;
  lineno?: number;
  colNo?: number;
  colno?: number;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  inApp?: boolean;
}
