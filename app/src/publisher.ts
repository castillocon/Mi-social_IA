import { audit } from "./lib/audit";
import { decryptSecret } from "./lib/crypto";
import { MetaError, type MetaClient } from "./lib/meta";
import { DAY, MINUTE } from "./lib/time";
import { isPublishable, refreshPostStatus, type PostRow, type TargetRow, type TargetStatus } from "./posts";

export const MAX_ATTEMPTS = 5;
export const IG_MAX_STATUS_CHECKS = 5;
const BATCH_SIZE = 20;
const STALE_LOCK_MS = 10 * MINUTE;
// Facebook acepta programar entre 10 minutos y 30 días; dejamos margen a cada lado.
const FB_NATIVE_MIN_MS = 12 * MINUTE;
const FB_NATIVE_MAX_MS = 29 * DAY;
const IG_CONTAINER_MAX_AGE_MS = 23 * 60 * MINUTE;

const CLAIMABLE = "('pending', 'ig_container_created', 'scheduled_native')";

interface Account {
  page_id: string;
  ig_user_id: string | null;
  page_token_enc: string;
}

interface Outcome {
  status: TargetStatus;
  nextAttemptAt?: Date;
  error?: string | null;
  set?: Partial<Pick<TargetRow, "container_id" | "container_created_at" | "status_checks" | "external_id">> & {
    published_at?: string;
  };
  countAttempt?: boolean;
}

export interface PublisherDeps {
  env: Pick<Env, "DB" | "TOKEN_ENC_KEY" | "MEDIA_BASE_URL">;
  meta: MetaClient;
  now?: Date;
}

export async function runPublisher({ env, meta, now = new Date() }: PublisherDeps) {
  const db = env.DB;
  const ts = now.toISOString();
  const summary = { claimed: 0, published: 0, failed: 0, deferred: 0, stale: 0 };

  // Un reclamo que quedó colgado (ejecución interrumpida) no se reintenta solo: podría duplicar el post.
  const stale = await db
    .prepare(
      `UPDATE post_targets SET status = 'failed', locked_at = NULL, updated_at = ?,
         last_error = 'Ejecución interrumpida durante la publicación: verificar en Meta antes de reintentar.'
       WHERE status = 'publishing' AND locked_at < ? RETURNING post_id`,
    )
    .bind(ts, new Date(now.getTime() - STALE_LOCK_MS).toISOString())
    .all<{ post_id: string }>();
  for (const r of stale.results) await refreshPostStatus(db, r.post_id, now);
  summary.stale = stale.results.length;

  const due = await db
    .prepare(`SELECT id FROM post_targets WHERE status IN ${CLAIMABLE} AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`)
    .bind(ts, BATCH_SIZE)
    .all<{ id: number }>();
  if (due.results.length === 0) return summary;

  const account = await db
    .prepare("SELECT page_id, ig_user_id, page_token_enc FROM meta_accounts WHERE status = 'active' ORDER BY id LIMIT 1")
    .first<Account>();
  if (!account) return { ...summary, skipped: "sin cuenta de Meta activa" };
  const token = await decryptSecret(account.page_token_enc, env.TOKEN_ENC_KEY);

  for (const { id } of due.results) {
    const target = await claim(db, id, now);
    if (!target) continue; // otra ejecución lo reclamó, o el post no cumple la regla
    summary.claimed++;
    const post = await db.prepare("SELECT * FROM posts WHERE id = ?").bind(target.post_id).first<PostRow>();

    let outcome: Outcome;
    if (!post || !isPublishable(post)) {
      outcome = { status: "failed", error: "Post no aprobado: bloqueado por la regla de aprobación." };
    } else {
      try {
        outcome =
          target.network === "facebook"
            ? await publishFacebook(meta, account, token, post, target, env.MEDIA_BASE_URL, now)
            : await publishInstagram(meta, account, token, post, target, env.MEDIA_BASE_URL, now);
      } catch (err) {
        outcome = await handleError(db, err, target, now);
      }
    }
    await release(db, target, outcome, now);
    if (outcome.status === "published") summary.published++;
    else if (outcome.status === "failed") summary.failed++;
    else summary.deferred++;
    await audit(db, "system:cron", `publish.${target.network}.${outcome.status}`, "post", target.post_id, {
      error: outcome.error ?? undefined,
    }, now);
    await refreshPostStatus(db, target.post_id, now);
  }
  return summary;
}

/** Reclamo atómico: solo una ejecución puede pasar el target a 'publishing', y solo si el post está aprobado. */
async function claim(db: D1Database, id: number, now: Date): Promise<TargetRow | null> {
  const ts = now.toISOString();
  return db
    .prepare(
      `UPDATE post_targets SET status = 'publishing', locked_at = ?, updated_at = ?
       WHERE id = ? AND status IN ${CLAIMABLE} AND next_attempt_at <= ?
         AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_targets.post_id
                     AND p.status IN ('approved', 'scheduled', 'publishing')
                     AND p.approved_by IS NOT NULL AND trim(p.approved_by) <> '' AND p.approved_at IS NOT NULL)
       RETURNING *`,
    )
    .bind(ts, ts, id, ts)
    .first<TargetRow>();
}

async function release(db: D1Database, target: TargetRow, o: Outcome, now: Date) {
  const set = o.set ?? {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(set, k);
  await db
    .prepare(
      `UPDATE post_targets SET status = ?, locked_at = NULL, updated_at = ?, next_attempt_at = ?, last_error = ?,
         attempts = attempts + ?,
         container_id = CASE WHEN ? THEN ? ELSE container_id END,
         container_created_at = CASE WHEN ? THEN ? ELSE container_created_at END,
         status_checks = CASE WHEN ? THEN ? ELSE status_checks END,
         external_id = CASE WHEN ? THEN ? ELSE external_id END,
         published_at = CASE WHEN ? THEN ? ELSE published_at END
       WHERE id = ? AND status = 'publishing'`,
    )
    .bind(
      o.status,
      now.toISOString(),
      (o.nextAttemptAt ?? now).toISOString(),
      o.error ?? null,
      o.countAttempt ? 1 : 0,
      has("container_id") ? 1 : 0, set.container_id ?? null,
      has("container_created_at") ? 1 : 0, set.container_created_at ?? null,
      has("status_checks") ? 1 : 0, set.status_checks ?? 0,
      has("external_id") ? 1 : 0, set.external_id ?? null,
      has("published_at") ? 1 : 0, set.published_at ?? null,
      target.id,
    )
    .run();
}

/** Estado al que vuelve un target que no terminó: depende de en qué paso estaba. */
function resumeStatus(t: TargetRow): TargetStatus {
  if (t.network === "instagram" && t.container_id) return "ig_container_created";
  if (t.network === "facebook" && t.external_id) return "scheduled_native";
  return "pending";
}

async function publishFacebook(
  meta: MetaClient,
  account: Account,
  token: string,
  post: PostRow,
  target: TargetRow,
  mediaBaseUrl: string,
  now: Date,
): Promise<Outcome> {
  const scheduledAt = new Date(post.scheduled_at!);

  // Ya programado de forma nativa: verificar que Meta lo publicó.
  if (target.external_id) {
    if (await meta.fbIsPublished(target.external_id, token)) {
      return { status: "published", set: { published_at: now.toISOString() } };
    }
    if (now.getTime() > scheduledAt.getTime() + 30 * MINUTE) {
      return { status: "failed", error: "Facebook no publicó el post programado a la hora prevista." };
    }
    return { status: "scheduled_native", nextAttemptAt: new Date(now.getTime() + 5 * MINUTE) };
  }

  const delta = scheduledAt.getTime() - now.getTime();
  const input = { message: post.fb_text, link: post.link_url, imageUrl: post.image_key ? `${mediaBaseUrl}/${post.image_key}` : null };

  if (delta >= FB_NATIVE_MIN_MS && delta <= FB_NATIVE_MAX_MS) {
    const r = await meta.fbPublish(account.page_id, token, { ...input, scheduledPublishTime: Math.floor(scheduledAt.getTime() / 1000) });
    return { status: "scheduled_native", set: { external_id: r.id }, nextAttemptAt: new Date(scheduledAt.getTime() + 2 * MINUTE) };
  }
  if (delta > FB_NATIVE_MAX_MS) {
    return { status: "pending", nextAttemptAt: new Date(scheduledAt.getTime() - FB_NATIVE_MAX_MS) };
  }
  if (delta > 0) {
    return { status: "pending", nextAttemptAt: scheduledAt }; // muy cerca para programar: lo publica el cron
  }
  const r = await meta.fbPublish(account.page_id, token, input);
  return { status: "published", set: { external_id: r.id, published_at: now.toISOString() } };
}

async function publishInstagram(
  meta: MetaClient,
  account: Account,
  token: string,
  post: PostRow,
  target: TargetRow,
  mediaBaseUrl: string,
  now: Date,
): Promise<Outcome> {
  if (!account.ig_user_id) return { status: "failed", error: "La página no tiene una cuenta de Instagram profesional vinculada." };
  if (!post.image_key) return { status: "failed", error: "Instagram requiere una imagen." };
  const scheduledAt = new Date(post.scheduled_at!);

  // Paso 1: crear el contenedor y salir (sin esperar dentro de la ejecución).
  if (!target.container_id) {
    const r = await meta.igCreateContainer(account.ig_user_id, token, {
      imageUrl: `${mediaBaseUrl}/${post.image_key}`,
      caption: post.ig_text,
    });
    return {
      status: "ig_container_created",
      set: { container_id: r.id, container_created_at: now.toISOString(), status_checks: 0 },
      nextAttemptAt: new Date(Math.max(now.getTime() + MINUTE, scheduledAt.getTime())),
    };
  }

  // Paso 2: consultar el estado del contenedor (una vez por ejecución) y publicar cuando esté FINISHED.
  const { status, detail } = await meta.igContainerStatus(target.container_id, token);
  if (status === "PUBLISHED") return { status: "published", set: { published_at: now.toISOString() } };
  if (status === "ERROR" || status === "EXPIRED") {
    return { status: "failed", error: `Contenedor de Instagram en estado ${status}${detail ? `: ${detail}` : ""}.` };
  }
  if (status === "IN_PROGRESS") {
    const checks = target.status_checks + 1;
    if (checks >= IG_MAX_STATUS_CHECKS) {
      return { status: "failed", error: `El contenedor de Instagram no terminó tras ${checks} consultas.`, set: { status_checks: checks } };
    }
    return { status: "ig_container_created", set: { status_checks: checks }, nextAttemptAt: new Date(now.getTime() + MINUTE) };
  }

  // FINISHED
  if (now < scheduledAt) return { status: "ig_container_created", nextAttemptAt: scheduledAt };
  const createdAt = new Date(target.container_created_at ?? now.toISOString());
  if (now.getTime() - createdAt.getTime() > IG_CONTAINER_MAX_AGE_MS) {
    // A punto de caducar (24 h): se crea uno nuevo en la próxima ejecución.
    return { status: "pending", set: { container_id: null, container_created_at: null, status_checks: 0 } };
  }
  const quota = await meta.igPublishingQuota(account.ig_user_id, token);
  if (quota.used >= quota.total) {
    return {
      status: "ig_container_created",
      error: `Límite de publicaciones de Instagram alcanzado (${quota.used}/${quota.total} en 24 h).`,
      nextAttemptAt: new Date(now.getTime() + 15 * MINUTE),
    };
  }
  const r = await meta.igPublish(account.ig_user_id, token, target.container_id);
  return { status: "published", set: { external_id: r.id, published_at: now.toISOString() } };
}

async function handleError(db: D1Database, err: unknown, target: TargetRow, now: Date): Promise<Outcome> {
  const message = err instanceof Error ? err.message : String(err);
  const attempts = target.attempts + 1;
  const backoff = new Date(now.getTime() + 2 ** Math.min(attempts - 1, 6) * MINUTE);

  if (err instanceof MetaError) {
    if (err.kind === "permission") {
      return { status: "failed", countAttempt: true, error: `Permiso faltante en Meta (código ${err.code}): ${message}` };
    }
    if (err.kind === "token") {
      await db
        .prepare("UPDATE meta_accounts SET status = 'reconnect_required', status_detail = ?, updated_at = ? WHERE status = 'active'")
        .bind(message, now.toISOString())
        .run();
      await audit(db, "system:cron", "meta.token_invalid", "meta_account", null, { code: err.code }, now);
    }
  }
  if (attempts >= MAX_ATTEMPTS) {
    return { status: "failed", countAttempt: true, error: `Falló tras ${attempts} intentos: ${message}` };
  }
  return { status: resumeStatus(target), countAttempt: true, error: message, nextAttemptAt: backoff };
}
