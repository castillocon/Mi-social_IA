# Changelog — Mi@Social_ia

## 2026-10-09 — FASE 1 (proyecto base) + núcleo del publicador

Hecho en un entorno en la nube **sin acceso** a la cuenta de Cloudflare, a Meta ni a choco.uy: no se creó,
modificó ni desplegó ningún recurso.

- Scaffold del Worker `misocial-ia`: TypeScript + Hono (JSX en el servidor), `wrangler.jsonc` con
  `compatibility_date` 2026-10-01, `workers_dev: false`, `preview_urls: false`, Custom Domain `social.choco.uy`,
  Workers Logs, crons `* * * * *` (publicador) y `10 9 * * *` (diario, 06:10 Montevideo).
- Dependencias fijadas: `hono` 4.13.13; dev: `wrangler` 4.149.0, `vitest` 4.1.11, `@cloudflare/vitest-plugin` 1.4.0,
  `typescript` 5.9.3.
  - **Diferencia con el prompt:** `@cloudflare/vitest-pool-workers` está deprecado y renombrado a
    `@cloudflare/vitest-plugin` (mismo producto). `typescript` se agrega para `tsc --noEmit`.
  - Hace falta **npm 11** (viene con Node 24): npm 10 falla al resolver las dependencias de esta versión.
- Migración D1 `0001_init.sql`: `meta_accounts`, `oauth_states`, `campaigns`, `posts` (texto FB e IG por separado,
  motivo de rechazo, costo de IA), `post_targets` (estado por red), `job_runs`, `audit_log`.
  Un `CHECK` en `posts` impide en la propia base un post fuera de `draft`/`rejected` sin aprobador y fecha.
- Publicador (`src/publisher.ts`):
  - Reclamo atómico `UPDATE … SET status='publishing' WHERE … AND EXISTS(post aprobado con aprobador y fecha) RETURNING`.
  - Regla inviolable aplicada en SQL y otra vez en código antes de llamar a Meta.
  - Facebook: programación nativa entre 12 min y 29 días (margen sobre 10 min / 30 días); si no, lo publica el cron.
  - Instagram en dos pasos sin esperas: contenedor 5 min antes → `status_code` una vez por minuto, máximo 5 →
    `content_publishing_limit` → `media_publish`.
  - Errores de Meta: 190 → cuenta `reconnect_required`; 4/17/32/613 → backoff; 10/200–299 → `failed`;
    máximo 5 intentos. Un reclamo colgado más de 10 min pasa a `failed` (no se reintenta solo, para no duplicar).
- Tokens cifrados con AES-GCM (`src/lib/crypto.ts`); el token va en la cabecera `Authorization`, nunca en la URL.
- Validación del JWT de Cloudflare Access (RS256, `aud`, `iss`, `exp`) en todas las rutas salvo
  `/health`, `/privacy`, `/data-deletion`, `/terms`. Sin configuración de Access, deniega (falla cerrada).
- Páginas públicas `/privacy`, `/data-deletion` (con callback `signed_request` de Meta) y `/terms`.
- Panel mínimo en `/` (estado de Meta, posts por estado, `job_runs`).
- 25 tests (Vitest en el runtime de Workers).

Validado: `tsc --noEmit`, `vitest run` (25/25), `wrangler dev` (health 200, `/` 403 sin Access, crons → `job_runs`).
