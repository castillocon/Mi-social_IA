# Auditoría — estado al 2026-10-09

Esta auditoría se hizo desde un entorno en la nube conectado solo al repositorio de GitHub. La red de ese entorno
**bloquea** choco.uy, developers.facebook.com, developers.cloudflare.com y la API de Cloudflare, y no tiene sesión de
Wrangler. Por eso casi toda la auditoría del prompt **sigue pendiente** y hay que hacerla en el PC de desarrollo.

| # | Punto | Estado | Cómo completarlo en el PC |
|---|---|---|---|
| 1 | Node, npm, Wrangler | Parcial | `node -v` (≥ 24), `npm -v` (≥ 11). Usar el Wrangler **local** del proyecto (`npx wrangler`, 4.149.0), no el global. |
| 2 | `wrangler whoami` / Workers Paid | Pendiente | `npx wrangler login` (lo hacés vos) y `npx wrangler whoami`. |
| 3 | Zona choco.uy | Pendiente | Panel → Websites, o `npx wrangler` + API. |
| 4 | DNS `social` y `media` | Pendiente | Panel → DNS. Si existen (incluido un túnel), **detenerse y preguntar**. |
| 5 | Workers, rutas, Custom Domains | Pendiente | `npx wrangler deployments list` por Worker; panel → Workers & Pages. |
| 6 | R2 | Pendiente | `npx wrangler r2 bucket list`. |
| 7 | Zero Trust / Access | Pendiente | Panel Zero Trust → Settings (team domain) y Access → Applications. |
| 8 | AI Gateway | Pendiente | Panel → AI → AI Gateway. |
| 9 | Fuente de contenido de choco.uy | Pendiente | Revisar `/sitemap.xml`, `/robots.txt`, RSS, catálogo. |
| 10 | Vigencia de la configuración de Meta | Pendiente | Changelog de Graph API, casos de uso, límites de IG, métricas retiradas, requisitos de Live. |
| 11 | Límites actuales de Cloudflare | Pendiente | Docs de Workers limits, D1 limits / Time Travel, R2. |

## Hallazgos ya confirmados

- `@cloudflare/vitest-pool-workers` está **deprecado** y renombrado a `@cloudflare/vitest-plugin`. Se usa el nuevo.
- La última versión de `vitest` es la 5.x, pero el plugin de Workers declara compatibilidad con `^4.1.0 || ^5.0.0`;
  se fija 4.1.11 por estabilidad.
- Con npm 10 (Node 22) la instalación falla (`Cannot read properties of null (reading 'edgesOut')`). Con npm 11
  funciona. npm 11 además exige aprobar scripts de instalación: ya están en `allowScripts` (`esbuild`, `workerd`).

## Riesgos

- **Publicación duplicada en Facebook:** si Meta publica pero la respuesta se pierde (timeout), el reintento puede
  duplicar. Mitigación: el reclamo colgado no se reintenta solo, y los reintentos por error genérico se limitan a 5.
- **`database_id` de D1** es un placeholder hasta crear la base en la FASE 2.
- **Access sin configurar** = la UI responde 403 a todo (falla cerrada), por diseño.
- Email de contacto de `/privacy`, `/data-deletion` y `/terms`: `chocouycorreo@gmail.com` (confirmado el 2026-10-09).
