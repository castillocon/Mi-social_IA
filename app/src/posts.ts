import { audit } from "./lib/audit";
import { MINUTE } from "./lib/time";

export type PostStatus = "draft" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "rejected";
export type Network = "facebook" | "instagram";
export type TargetStatus =
  | "pending"
  | "publishing"
  | "scheduled_native"
  | "ig_container_created"
  | "published"
  | "failed"
  | "cancelled";

export interface PostRow {
  id: string;
  status: PostStatus;
  fb_text: string;
  ig_text: string;
  link_url: string | null;
  image_key: string | null;
  scheduled_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export interface TargetRow {
  id: number;
  post_id: string;
  network: Network;
  status: TargetStatus;
  attempts: number;
  next_attempt_at: string;
  container_id: string | null;
  container_created_at: string | null;
  status_checks: number;
  external_id: string | null;
}

/** El contenedor de Instagram se crea unos minutos antes de la hora programada (caduca a las 24 h). */
export const IG_CONTAINER_LEAD_MS = 5 * MINUTE;

export class ValidationError extends Error {}

/**
 * Regla inviolable: solo se publica lo aprobado con aprobador (email de Access) y fecha de aprobación registrados.
 * El cron la aplica en SQL al reclamar y otra vez aquí, antes de llamar a Meta.
 */
export function isPublishable(post: Pick<PostRow, "status" | "approved_by" | "approved_at">): boolean {
  return (
    ["approved", "scheduled", "publishing"].includes(post.status) &&
    typeof post.approved_by === "string" &&
    post.approved_by.trim() !== "" &&
    typeof post.approved_at === "string" &&
    post.approved_at !== ""
  );
}

// Límites de caption de Instagram.
export function validateIgCaption(caption: string): string[] {
  const errors: string[] = [];
  if ([...caption].length > 2200) errors.push("El texto de Instagram supera 2200 caracteres.");
  if ((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) errors.push("El texto de Instagram supera 30 hashtags.");
  if ((caption.match(/@[\w.]+/g) ?? []).length > 20) errors.push("El texto de Instagram supera 20 menciones.");
  return errors;
}

export async function createDraft(
  db: D1Database,
  actor: string,
  input: { fbText: string; igText: string; linkUrl?: string | null; imageKey?: string | null; sourceKind?: string },
  now = new Date(),
): Promise<string> {
  const id = crypto.randomUUID();
  const ts = now.toISOString();
  await db
    .prepare(
      `INSERT INTO posts (id, status, fb_text, ig_text, link_url, image_key, source_kind, created_by, created_at, updated_at)
       VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.fbText, input.igText, input.linkUrl ?? null, input.imageKey ?? null, input.sourceKind ?? "manual", actor, ts, ts)
    .run();
  await audit(db, actor, "post.create", "post", id, { sourceKind: input.sourceKind ?? "manual" }, now);
  return id;
}

export async function approvePost(
  db: D1Database,
  postId: string,
  approver: string,
  scheduledAt: Date,
  networks: Network[],
  now = new Date(),
): Promise<void> {
  if (!approver || !approver.includes("@")) throw new ValidationError("Aprobador inválido.");
  if (Number.isNaN(scheduledAt.getTime())) throw new ValidationError("Fecha de publicación inválida.");
  if (networks.length === 0) throw new ValidationError("Elegí al menos una red.");

  const post = await db.prepare("SELECT * FROM posts WHERE id = ?").bind(postId).first<PostRow>();
  if (!post) throw new ValidationError("Post inexistente.");
  if (post.status !== "draft") throw new ValidationError(`Solo se aprueba un borrador (estado actual: ${post.status}).`);
  if (networks.includes("facebook") && !post.fb_text.trim() && !post.image_key) throw new ValidationError("Falta el texto de Facebook.");
  if (networks.includes("instagram")) {
    if (!post.image_key) throw new ValidationError("Instagram requiere una imagen.");
    const errors = validateIgCaption(post.ig_text);
    if (errors.length) throw new ValidationError(errors.join(" "));
  }

  const ts = now.toISOString();
  const nextAttempt = (network: Network) =>
    network === "instagram"
      ? new Date(Math.max(now.getTime(), scheduledAt.getTime() - IG_CONTAINER_LEAD_MS)).toISOString()
      : ts; // Facebook: el cron decide si programa de forma nativa o espera.

  await db.batch([
    db
      .prepare(
        `UPDATE posts SET status = 'approved', approved_by = ?, approved_at = ?, scheduled_at = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      )
      .bind(approver, ts, scheduledAt.toISOString(), ts, postId),
    ...networks.map((network) =>
      db
        .prepare(
          `INSERT INTO post_targets (post_id, network, status, next_attempt_at, updated_at) VALUES (?, ?, 'pending', ?, ?)
           ON CONFLICT (post_id, network) DO UPDATE SET status = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at,
             last_error = NULL, container_id = NULL, container_created_at = NULL, status_checks = 0, external_id = NULL,
             updated_at = excluded.updated_at`,
        )
        .bind(postId, network, nextAttempt(network), ts),
    ),
  ]);
  await audit(db, approver, "post.approve", "post", postId, { scheduledAt: scheduledAt.toISOString(), networks }, now);
}

export async function rejectPost(db: D1Database, postId: string, actor: string, reason: string, now = new Date()): Promise<void> {
  if (!reason.trim()) throw new ValidationError("Indicá el motivo del rechazo.");
  const ts = now.toISOString();
  const row = await db
    .prepare(
      `UPDATE posts SET status = 'rejected', rejected_by = ?, rejected_at = ?, rejection_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'draft' RETURNING id`,
    )
    .bind(actor, ts, reason.trim(), ts, postId)
    .first();
  if (!row) throw new ValidationError("Solo se rechaza un borrador.");
  await audit(db, actor, "post.reject", "post", postId, { reason: reason.trim() }, now);
}

/** Recalcula el estado del post a partir del estado de cada red. */
export function rollupStatus(targets: TargetStatus[], scheduledAt: string | null, now: Date): PostStatus {
  const active = targets.filter((s) => s !== "cancelled");
  if (active.length === 0) return "approved";
  if (active.every((s) => s === "published")) return "published";
  if (active.includes("publishing")) return "publishing";
  const pending = active.filter((s) => s === "pending" || s === "scheduled_native" || s === "ig_container_created");
  if (pending.length === 0) return "failed"; // solo quedan published/failed y al menos uno falló
  if (active.every((s) => s === "pending")) return "approved";
  const future = scheduledAt !== null && new Date(scheduledAt).getTime() > now.getTime();
  return future ? "scheduled" : "publishing";
}

export async function refreshPostStatus(db: D1Database, postId: string, now = new Date()): Promise<PostStatus | null> {
  const post = await db.prepare("SELECT status, scheduled_at FROM posts WHERE id = ?").bind(postId).first<PostRow>();
  if (!post || post.status === "draft" || post.status === "rejected") return post?.status ?? null;
  const { results } = await db.prepare("SELECT status FROM post_targets WHERE post_id = ?").bind(postId).all<{ status: TargetStatus }>();
  const status = rollupStatus(
    results.map((r) => r.status),
    post.scheduled_at,
    now,
  );
  if (status !== post.status) {
    await db
      .prepare("UPDATE posts SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('draft', 'rejected')")
      .bind(status, now.toISOString(), postId)
      .run();
  }
  return status;
}
