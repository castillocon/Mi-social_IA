# Mi@Social_ia

Genera contenido con IA para choco.uy, lo somete a aprobación humana y lo publica en Facebook e Instagram con la
Graph API oficial de Meta. Corre 100 % en Cloudflare (Workers + D1 + R2 + Cron Triggers + Access).

URL: `https://misocial-ia.<subdominio>.workers.dev`, protegida con Cloudflare Access (choco.uy no está en Cloudflare por ahora).

Especificación completa: [`../Mi@Social_IA_cloudflare.md`](../Mi@Social_IA_cloudflare.md).
Estado y cambios: [`docs/CHANGELOG.md`](docs/CHANGELOG.md) · Auditoría: [`docs/AUDITORIA.md`](docs/AUDITORIA.md).

## Requisitos

Node.js 24 con **npm 11**. Wrangler se usa desde el proyecto (`npx wrangler`), no el global.

## Desarrollo local

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars   # completar TOKEN_ENC_KEY (ver abajo)
npm run db:migrate:local
npm run dev                             # http://localhost:8787
npm run typecheck
npm test
```

Probar los crons en local: `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"`.

Generar `TOKEN_ENC_KEY` (32 bytes en base64) sin mostrarla en pantalla y cargarla como secret:

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put TOKEN_ENC_KEY
```

## Estructura

| Ruta | Qué es |
|---|---|
| `src/index.ts` | Worker: rutas HTTP y handler de los crons |
| `src/publisher.ts` | Publicador (cron por minuto): reclamo atómico, FB nativo/inmediato, IG en dos pasos |
| `src/posts.ts` | Borradores, aprobación, rechazo, regla inviolable, estado agregado |
| `src/lib/` | Access (JWT), cifrado AES-GCM, cliente Graph API, auditoría y `job_runs` |
| `src/routes/` | Páginas públicas (`/health`, `/privacy`, `/data-deletion`, `/terms`, `/media/*`) y la UI |
| `migrations/` | Migraciones D1 versionadas |
| `test/` | Tests Vitest en el runtime de Workers (Meta simulado) |

## Fases

- [x] FASE 1 — Proyecto base (validado en local)
- [ ] FASE 2 — Recursos Cloudflare (requiere tu confirmación tras la auditoría)
- [ ] FASES 3–10
