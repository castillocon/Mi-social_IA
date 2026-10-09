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

## 2026-10-09 — Email de contacto

- `/privacy`, `/data-deletion` y `/terms` usan el email confirmado `chocouycorreo@gmail.com`.

## 2026-10-09 — Decisión: workers.dev en lugar de social.choco.uy

**Motivo:** la auditoría mostró que choco.uy usa los DNS de afraid.org, no Cloudflare, así que no hay Custom Domain,
dominio de R2 ni Access sobre choco.uy. Decidido con el usuario: usar workers.dev ahora y mudar a choco.uy más adelante.

Esto **reemplaza** dos reglas del prompt original ("Deshabilitar workers.dev" y `media.choco.uy` sobre R2):

- `workers_dev: true` como **única** URL, protegida con Cloudflare Access; `preview_urls: false` sigue apagado.
  El Worker además valida el JWT de Access por su cuenta: sin JWT válido responde 403.
- Sin Custom Domain. `PUBLIC_BASE_URL` y `MEDIA_BASE_URL` llevan `CAMBIAR` hasta conocer el subdominio workers.dev.
- Imágenes: el bucket R2 queda **privado** y el Worker las sirve en `/media/<32 hex>.jpg` (ruta pública,
  excluida de Access). No se usa `r2.dev` (Cloudflare lo desaconseja para producción).
- `/health` informa `configured: false` mientras falte el subdominio o la configuración de Access.

Para mudar a choco.uy: zona en Cloudflare → `routes` con Custom Domain → nueva aplicación de Access → actualizar
las URLs en la app de Meta → reconectar Meta.

## 2026-10-09 — Acceso a la UI

- Cloudflare Access (OTP por email) permitirá **dos** emails: `castilloconsultores@gmail.com` y
  `chocouycorreo@gmail.com`. Ambos pueden aprobar; el email del JWT queda registrado como aprobador en cada post.
