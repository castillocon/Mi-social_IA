// Cliente mínimo de la Graph API de Meta. La versión viene de META_API_VERSION; nunca fija en el código.

export type MetaErrorKind = "token" | "rate_limit" | "permission" | "other";

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null = null,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "MetaError";
  }

  get kind(): MetaErrorKind {
    if (this.code === 190) return "token";
    if (this.code !== null && [4, 17, 32, 613].includes(this.code)) return "rate_limit";
    if (this.code === 10 || this.code === 200 || (this.code !== null && this.code > 200 && this.code < 300)) return "permission";
    return "other";
  }
}

export type IgContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

export interface FbPublishInput {
  message: string;
  link?: string | null;
  imageUrl?: string | null;
  /** Unix (segundos). Si está, se programa de forma nativa con published=false. */
  scheduledPublishTime?: number;
}

export interface MetaClient {
  fbPublish(pageId: string, token: string, input: FbPublishInput): Promise<{ id: string }>;
  fbIsPublished(postId: string, token: string): Promise<boolean>;
  igCreateContainer(igUserId: string, token: string, input: { imageUrl: string; caption: string }): Promise<{ id: string }>;
  igContainerStatus(containerId: string, token: string): Promise<{ status: IgContainerStatus; detail?: string }>;
  igPublish(igUserId: string, token: string, creationId: string): Promise<{ id: string }>;
  igPublishingQuota(igUserId: string, token: string): Promise<{ used: number; total: number }>;
}

type Params = Record<string, string | number | boolean | null | undefined>;

export class GraphClient implements MetaClient {
  private readonly base: string;

  constructor(apiVersion: string, private readonly fetchFn: typeof fetch = fetch) {
    this.base = `https://graph.facebook.com/${apiVersion}`;
  }

  private async call<T>(method: "GET" | "POST", path: string, token: string, params: Params = {}): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, String(v));
    // El token va en la cabecera, nunca en la URL (no aparece en logs).
    const headers = { Authorization: `Bearer ${token}` };
    const res =
      method === "GET"
        ? await this.fetchFn(`${this.base}/${path}?${body}`, { headers })
        : await this.fetchFn(`${this.base}/${path}`, { method, headers, body });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number } };
    if (!res.ok || json.error) {
      const e = json.error ?? {};
      throw new MetaError(e.message ?? `HTTP ${res.status}`, e.code ?? null, e.error_subcode ?? null, res.status);
    }
    return json as T;
  }

  async fbPublish(pageId: string, token: string, input: FbPublishInput) {
    const schedule = input.scheduledPublishTime
      ? { published: false, scheduled_publish_time: input.scheduledPublishTime }
      : {};
    if (input.imageUrl) {
      const r = await this.call<{ id: string; post_id?: string }>("POST", `${pageId}/photos`, token, {
        url: input.imageUrl,
        message: input.message,
        ...schedule,
      });
      return { id: r.post_id ?? r.id };
    }
    return this.call<{ id: string }>("POST", `${pageId}/feed`, token, {
      message: input.message,
      link: input.link,
      ...schedule,
    });
  }

  async fbIsPublished(postId: string, token: string) {
    const r = await this.call<{ is_published?: boolean }>("GET", postId, token, { fields: "is_published" });
    return r.is_published === true;
  }

  igCreateContainer(igUserId: string, token: string, input: { imageUrl: string; caption: string }) {
    return this.call<{ id: string }>("POST", `${igUserId}/media`, token, { image_url: input.imageUrl, caption: input.caption });
  }

  async igContainerStatus(containerId: string, token: string) {
    const r = await this.call<{ status_code: IgContainerStatus; status?: string }>("GET", containerId, token, {
      fields: "status_code,status",
    });
    return { status: r.status_code, detail: r.status };
  }

  igPublish(igUserId: string, token: string, creationId: string) {
    return this.call<{ id: string }>("POST", `${igUserId}/media_publish`, token, { creation_id: creationId });
  }

  async igPublishingQuota(igUserId: string, token: string) {
    const r = await this.call<{ data: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
      "GET",
      `${igUserId}/content_publishing_limit`,
      token,
      { fields: "quota_usage,config" },
    );
    const d = r.data[0] ?? {};
    return { used: d.quota_usage ?? 0, total: d.config?.quota_total ?? 100 };
  }
}
