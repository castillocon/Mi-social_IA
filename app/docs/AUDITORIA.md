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

## Resultado en el PC (2026-10-09 21:18 UTC)

| # | Punto | Resultado |
|---|---|---|
| 1 | Versiones | Node 24.20.0, npm 11.7.0, Wrangler del proyecto 4.149.0. El global (4.87.0) está desactualizado: usar siempre `npx wrangler`. |
| 2 | Cuenta | OAuth de castilloconsultores@gmail.com, una sola cuenta. Scopes suficientes para Workers, D1, R2, AI y Email. No incluye Access/Zero Trust: esa parte va por el panel. Plan Workers Paid: confirmar en el panel. |
| 3 | Zona choco.uy | **BLOQUEANTE: los nameservers son `ns1–4.afraid.org` (FreeDNS), no Cloudflare.** Sin la zona en Cloudflare no hay Custom Domain del Worker, dominio propio de R2 ni Access sobre `social.choco.uy`. |
| 4 | DNS `social` / `media` | No existen (sin conflicto). |
| 5 | Worker `misocial-ia` | No existe (código 10007): el nombre está libre. |
| 6 | R2 | Habilitado, 15 buckets; `misocial-ia-media` no existe (libre). |
| — | D1 | 18 bases; `misocial-ia` no existe (libre). |
| 9 | choco.uy | El sitio **no respondió** ("No es posible conectar con el servidor remoto"). Falta saber dónde está la tienda y qué fuente de contenido usar. |
| 7, 8, 10, 11 | Access, AI Gateway, Meta, límites | Pendientes (panel y documentación). |

**Decisión (2026-10-09):** se usa `misocial-ia.<subdominio>.workers.dev` protegido con Access; choco.uy se mudará más
adelante. Ver `CHANGELOG.md`.
