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

## 2026-10-09 — FASE 2: Access y Worker público

- Access del Worker `misocial-ia` activado en modo **All traffic** (producción y previews), política
  *Cloudflare account members*. Team domain `https://castillouy.cloudflareaccess.com`; AUD cargado en `wrangler.jsonc`.
- El panel no permite excepciones por ruta en workers.dev, así que las rutas públicas pasan a un **segundo Worker**,
  `misocial-ia-public` (`wrangler.public.jsonc`, entrada `src/public-worker.ts`): `/privacy`, `/data-deletion`,
  `/terms`, `/health` y `/media/<clave>`. Sin crons ni UI; usa la misma D1 y el mismo R2.
- La app `misocial-ia` ya no expone nada público: todo exige el JWT de Access.
- Variables: `APP_BASE_URL` (app), `PUBLIC_BASE_URL` y `MEDIA_BASE_URL` (Worker público).
- Scripts: `npm run deploy:public` y `npm run deploy:all` (typecheck + tests + ambos deploys).
- Pendiente: sumar `chocouycorreo@gmail.com` editando la política en Zero Trust → Access → Applications.

## 2026-10-09 — FASE 2 validada

Validado por el usuario en ventana de incógnito:
- `misocial-ia.castilloconsultores.workers.dev/` pide login de Access y, tras el login, muestra el panel con la sesión.
- `misocial-ia-public…/health` → `ok: true`, `configured: true`.
- `misocial-ia-public…/privacy` se ve sin login.
- La preview URL `7a3e6163-misocial-ia…` no expone el panel.

## 2026-10-09 — FASE 3, paso 1: requisitos de las cuentas

- Portfolio comercial "authentic chocolate experience" con la página **Choco.uy** y el Instagram **@choco.uy**
  (cuenta profesional, categoría Producto/servicio) vinculados.
- Publicar desde Business Suite en ambas redes funciona: sin bloqueo de PPA visible.
- El administrador del portfolio entraba con la identidad de Instagram. Para la API se usa el **perfil personal de
  Facebook "Ana Claudia Vallejo Mariño"**, ahora con **acceso total** al portfolio, a la página y al Instagram.
- Ese acceso a la página viene **a través del portfolio**: si la API lo exige, habrá que sumar `ads_management` y
  `ads_read` (solo si aparece el error).

## 2026-10-09 — FASE 3, pasos 3c–3d: app de Meta

- App **Mi@Social_ia** (Meta aceptó la `@`), App ID `1781965366358086`, en modo desarrollo ("Sin publicar"),
  creada con el perfil de Facebook de Ana Claudia y conectada al portfolio "authentic chocolate experience".
- Casos de uso: "Administrar todo en tu página" y "Administrar mensajes y contenido en Instagram" (variante
  **API con inicio de sesión con Facebook**). Los 8 permisos del MVP en "Listo para la prueba".
  Quedaron agregados de más, sin pedirse en el login: `email`, `instagram_manage_messages`, Live Video API.
- Facebook Login for Business: Client OAuth y Web OAuth activados, HTTPS y modo estricto activados,
  redirect URI `https://misocial-ia.castilloconsultores.workers.dev/auth/callback` validada.
- Configuración `misocial-ia`, `config_id` `890216964059448` (token de usuario; páginas e Instagram; los 8 permisos).

## 2026-10-09 — FASE 3, pasos 4–6

- App settings → Básica: dominios workers.dev de la app y del Worker público, URLs de privacidad, términos y
  **URL de instrucciones** de eliminación de datos (no se usa el callback firmado por ahora), email de contacto.
- Secrets cargados en `misocial-ia`: `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `TOKEN_ENC_KEY`.
- Graph API Explorer (`me/accounts`): página **Choco.uy** `103542077711873`, Instagram business account
  `17841420719322291`; tasks incluyen `MANAGE`, `CREATE_CONTENT` y `MODERATE`.
- `content_publishing_limit` del Instagram: `quota_total: 100`, `quota_duration: 86400` (100 publicaciones por API
  cada 24 h, confirma el prompt). La Graph API **v26.0** responde, así que `META_API_VERSION` es válida.
