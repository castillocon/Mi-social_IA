// UI protegida por Access. Por ahora un panel de estado; la UI de aprobación completa llega en la FASE 7.
import { Hono } from "hono";
import type { AppEnv } from "../lib/access";
import { formatLocal } from "../lib/time";
import { Layout } from "./layout";

export const uiRoutes = new Hono<AppEnv>();

uiRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const [counts, runs, account] = await Promise.all([
    db.prepare("SELECT status, COUNT(*) AS n FROM posts GROUP BY status").all<{ status: string; n: number }>(),
    db.prepare("SELECT job, started_at, finished_at, status, error FROM job_runs ORDER BY id DESC LIMIT 10").all<{
      job: string; started_at: string; finished_at: string | null; status: string; error: string | null;
    }>(),
    db.prepare("SELECT page_name, ig_username, status FROM meta_accounts ORDER BY id LIMIT 1").first<{
      page_name: string | null; ig_username: string | null; status: string;
    }>(),
  ]);
  const tz = c.env.DISPLAY_TZ;
  return c.html(
    <Layout title="Panel">
      <h1>Mi@Social_ia</h1>
      <p class="muted">Sesión: {c.get("user").email}</p>
      <h2>Meta</h2>
      <p>
        {account
          ? `${account.page_name ?? "Página"} / @${account.ig_username ?? "—"} — ${account.status === "active" ? "conectada" : "reconexión requerida"}`
          : "Sin conectar (FASE 4)."}
      </p>
      <h2>Posts por estado</h2>
      <table>
        <tbody>
          {counts.results.length === 0 ? <tr><td>Sin posts todavía.</td></tr> : null}
          {counts.results.map((r) => (
            <tr><td>{r.status}</td><td>{r.n}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>Últimas ejecuciones</h2>
      <table>
        <thead><tr><th>Job</th><th>Inicio</th><th>Fin</th><th>Resultado</th></tr></thead>
        <tbody>
          {runs.results.map((r) => (
            <tr>
              <td>{r.job}</td><td>{formatLocal(r.started_at, tz)}</td><td>{formatLocal(r.finished_at, tz)}</td>
              <td>{r.status}{r.error ? ` — ${r.error}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>,
  );
});
