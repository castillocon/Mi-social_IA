export async function audit(
  db: D1Database,
  actor: string,
  action: string,
  entity: string,
  entityId: string | null,
  details?: Record<string, unknown>,
  at = new Date(),
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (at, actor, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(at.toISOString(), actor, action, entity, entityId, details ? JSON.stringify(details) : null)
    .run();
}

/** Registra el inicio y fin de una ejecución de cron en `job_runs`. */
export async function withJobRun<T extends Record<string, unknown>>(
  db: D1Database,
  job: string,
  fn: () => Promise<T>,
): Promise<T> {
  const started = await db
    .prepare("INSERT INTO job_runs (job, started_at) VALUES (?, ?) RETURNING id")
    .bind(job, new Date().toISOString())
    .first<{ id: number }>();
  const finish = (status: "ok" | "error", summary: string | null, error: string | null) =>
    db
      .prepare("UPDATE job_runs SET finished_at = ?, status = ?, summary = ?, error = ? WHERE id = ?")
      .bind(new Date().toISOString(), status, summary, error, started!.id)
      .run();
  try {
    const result = await fn();
    await finish("ok", JSON.stringify(result), null);
    return result;
  } catch (err) {
    await finish("error", null, String(err instanceof Error ? err.message : err));
    throw err;
  }
}
