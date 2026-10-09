import { env } from "cloudflare:workers";
import { encryptSecret } from "../src/lib/crypto";
import type { IgContainerStatus, MetaClient } from "../src/lib/meta";
import { approvePost, createDraft, type Network } from "../src/posts";

export const APPROVER = "aprobador@choco.uy";

export async function resetDb() {
  await env.DB.batch(
    ["audit_log", "job_runs", "post_targets", "posts", "meta_accounts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
}

export async function connectAccount() {
  const enc = await encryptSecret("PAGE_TOKEN_TEST", env.TOKEN_ENC_KEY);
  const ts = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO meta_accounts (page_id, page_name, ig_user_id, ig_username, page_token_enc, connected_by, created_at, updated_at)
     VALUES ('PAGE1', 'choco.uy', 'IG1', 'choco.uy', ?, ?, ?, ?)`,
  )
    .bind(enc, APPROVER, ts, ts)
    .run();
}

export async function approvedPost(networks: Network[], scheduledAt: Date, now: Date) {
  const id = await createDraft(env.DB, "editor@choco.uy", { fbText: "Hola FB", igText: "Hola IG #chocolate", imageKey: "abc123.jpg" }, now);
  await approvePost(env.DB, id, APPROVER, scheduledAt, networks, now);
  return id;
}

export const minutes = (base: Date, m: number) => new Date(base.getTime() + m * 60_000);

/** Meta simulado: registra llamadas y permite fijar respuestas. */
export function fakeMeta(overrides: Partial<MetaClient> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const igStatuses: IgContainerStatus[] = [];
  const record =
    <A extends unknown[], R>(method: string, fn: (...a: A) => Promise<R>) =>
    (...args: A) => {
      calls.push({ method, args });
      return fn(...args);
    };
  const client: MetaClient = {
    fbPublish: record("fbPublish", overrides.fbPublish ?? (async () => ({ id: `FBPOST_${calls.length}` }))),
    fbIsPublished: record("fbIsPublished", overrides.fbIsPublished ?? (async () => true)),
    igCreateContainer: record("igCreateContainer", overrides.igCreateContainer ?? (async () => ({ id: "CONTAINER1" }))),
    igContainerStatus: record(
      "igContainerStatus",
      overrides.igContainerStatus ?? (async () => ({ status: igStatuses.shift() ?? "FINISHED" })),
    ),
    igPublish: record("igPublish", overrides.igPublish ?? (async () => ({ id: "IGMEDIA1" }))),
    igPublishingQuota: record("igPublishingQuota", overrides.igPublishingQuota ?? (async () => ({ used: 3, total: 100 }))),
  };
  const count = (m: string) => calls.filter((c) => c.method === m).length;
  return { client, calls, count, igStatuses };
}

export const target = (postId: string, network: Network) =>
  env.DB.prepare("SELECT * FROM post_targets WHERE post_id = ? AND network = ?").bind(postId, network).first<Record<string, unknown>>();

export const postStatus = async (postId: string) =>
  (await env.DB.prepare("SELECT status FROM posts WHERE id = ?").bind(postId).first<{ status: string }>())?.status;
