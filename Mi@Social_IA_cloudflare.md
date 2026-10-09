Este prompt es autocontenido. Si existe `CLAUDE.md` en el proyecto, léelo primero; si contradice este prompt, detente y pregunta.

Quiero que construyas **Mi@Social_ia** (instancia para choco.uy): una app que genera contenido con IA, lo somete a aprobación humana y lo publica en Facebook e Instagram usando **directamente las APIs oficiales de Meta (Graph API)**.

Corre **100 % en Cloudflare**. No usar Postiz, servidores propios, túneles, Docker, WSL ni VMs.

## CONTEXTO

- **Nombre:** `Mi@Social_ia` es el nombre visible en la UI, `<title>`, README y nombre de la app de Meta (si Meta no acepta `@`, usar `MiSocial IA`). El identificador técnico es `misocial-ia`, en minúsculas y sin `@`: nombre del Worker, D1, R2, `package.json`. Los dominios siguen siendo de choco.uy.

- La cuenta de Cloudflare tiene **Workers Paid** activo. El dominio choco.uy debería estar en esa cuenta (verificarlo).
- Equipo de desarrollo: Windows 11 con Node.js v24.20, npm, Wrangler (instalado globalmente), Git y PowerShell. Claude Code corre aquí.
- Proyecto en `G:\chocoSocial_IA\app`; backups en `G:\chocoSocial_IA\backups`, fuera de Git.
- cloudflared también está instalado en este PC; puede haber túneles existentes. No tocarlos.

## ARQUITECTURA

| Necesidad | Producto |
|---|---|
| UI de aprobación + API + callback OAuth | **Worker** en TypeScript con **Hono**; UI renderizada en el servidor (JSX de Hono o plantillas), con HTMX solo si aporta. Sin framework SPA ni build pesado. |
| Base de datos | **D1** (SQLite), con migraciones versionadas (`wrangler d1 migrations`) |
| Imágenes | **R2** con dominio propio `media.choco.uy` (público, con claves aleatorias no adivinables) |
| Publicador | **Cron Trigger** `* * * * *` |
| Estadísticas | **Cron Trigger** diario |
| Secretos | **Workers Secrets** (`wrangler secret put`, los introduzco yo) |
| Tokens de Meta | Cifrados con AES-GCM (WebCrypto) en D1; clave en un secret |
| Autenticación de la UI | **Cloudflare Access** (OTP por email, solo mi email) + validación del JWT de Access dentro del Worker (defensa en profundidad) |
| Llamadas a la IA | Anthropic API mediante fetch, pasando por **AI Gateway** (logs, costos, límites) |
| Observabilidad | Workers Logs habilitado |
| Tests | Vitest con `@cloudflare/vitest-pool-workers` |

Dominios y rutas:

- `social.choco.uy` → Worker (Custom Domain), protegido con Access **excepto** `/privacy`, `/data-deletion` y `/health`.
- `media.choco.uy` → bucket R2, público.
- **Deshabilitar `workers.dev` y las preview URLs**, para que no exista ningún acceso que esquive Access.

Dependencias mínimas: hono, wrangler y vitest (desarrollo). Cualquier otra dependencia, justifícala antes de añadirla. Versiones fijadas en `package.json` y `compatibility_date` explícita en `wrangler.jsonc`.

Zona horaria: guardar en UTC y mostrar en `America/Montevideo`. Recordar que los Cron Triggers se evalúan en UTC.

## FLUJO Y REGLAS DE NEGOCIO

choco.uy (fuente de contenido)
→ IA genera **borrador** (texto + imagen elegida o subida)
→ revisión humana en la UI (editar / aprobar / rechazar)
→ **aprobado** con fecha
→ publicación (FB e IG)
→ estadísticas

- Estados: `draft → approved → scheduled → publishing → published | failed | rejected`.
- **Regla inviolable:** nada se publica si no está aprobado y no tiene registrados el aprobador (email del JWT de Access) y la fecha de aprobación. Debe cumplirse en el código del cron, no solo en la UI, y cubrirse con un test.
- **Idempotencia y concurrencia:** el cron "reclama" cada post con un `UPDATE ... SET status='publishing' WHERE id=? AND status IN (...) RETURNING`, de forma atómica, para que dos ejecuciones nunca publiquen lo mismo. Guardar el ID devuelto por Meta.
- Reintentos acotados con backoff y error guardado; tras N fallos pasa a `failed` y aparece en la UI.
- Tabla `job_runs` (inicio, fin, resultado de cada cron) y tabla `audit_log` (quién, cuándo, qué).

Facebook:

- Programación nativa de la página (`scheduled_publish_time`, verificando los límites actuales) para posts con fecha futura dentro del rango permitido; si no, la publica el cron.
- Imagen por URL de R2 o subida directa.

Instagram:

- Lo publica el cron, en dos pasos y **sin esperar dentro de la ejecución**: (1) crear el contenedor con la URL de `media.choco.uy` y pasar el post a `ig_container_created`; (2) en ejecuciones siguientes, consultar `status_code` y, cuando esté `FINISHED`, hacer `media_publish`.
- Validar formato, tamaño y relación de aspecto **en el navegador** al subir la imagen, y revalidar con la cabecera del archivo en el Worker. Sin librerías de imagen.
- Consultar el límite diario de publicaciones (`content_publishing_limit`) antes de publicar.

## CONFIGURACIÓN DE META (investigada el 2026-10-08; revalidar en la auditoría)

### Decisiones

- **Una sola app de Meta** para Facebook e Instagram, tipo **Business**, conectada al portfolio comercial (Business Manager) de choco.uy.
- Instagram con **"Instagram API with Facebook Login"** (host `graph.facebook.com`, token de página). No usar "Instagram Login": requeriría otra app y otro tipo de token.
- **Uso propio:** solo las cuentas de choco.uy y solo usuarios con rol en la app. Por eso basta con el **acceso estándar**: no hace falta App Review ni verificación del negocio para los permisos estándar.
  - La verificación y el App Review solo serán necesarios si en el futuro se gestionan páginas de terceros, o para Page Public Content Access.
- **La app debe pasar a modo Live** (publicada): en modo desarrollo los posts creados por la API solo los ven los usuarios con rol en la app, y las imágenes no se muestran al público.
  - Al pasar a Live, los posts de prueba hechos en modo desarrollo se vuelven públicos. **Borrarlos antes** de pasar a Live, o probar en una página de prueba.
  - Si el panel exige App Review o verificación para pasar a Live, **detente y explícame la diferencia**.
- **Graph API v26.0** (lanzada el 2026-07-29), configurable en `META_API_VERSION`. Ninguna versión fija en el código.
  - Revisar el changelog cada 6 meses: cada versión dura unos 2 años; v25.0 vence el 2028-07-29.

### Casos de uso a agregar en la app

1. **"Manage everything on your Page"**. Se agregan solos y no se pueden quitar: `business_management`, `pages_show_list` y `public_profile`.
2. **"Manage messaging and content on Instagram"** → **API setup with Facebook Login** → "Add all required permissions" (contenido).
3. Producto **Facebook Login for Business** → crear una **Configuration**:
   - token de tipo **User access token**
   - activos: la página de choco.uy y su Instagram
   - los permisos listados abajo

   Se usa su `config_id` en el diálogo OAuth, **sin** `scope`.
   - Si los casos de uso 1 y 2 no se pueden combinar en una misma app, detente y avísame.
   - Los nombres de los casos de uso cambian con el tiempo: verificarlos en el panel.

### Permisos del MVP (solo estos)

| Permiso | Para qué |
|---|---|
| `pages_show_list` | Listar la página |
| `business_management` | Activos del portfolio comercial (obligatorio en el caso de uso) |
| `pages_manage_posts` | Publicar y programar en la página |
| `pages_read_engagement` | Leer posts y engagement; también lo requiere Instagram |
| `read_insights` | Estadísticas de la página y de los posts (confirmar si lo sigue exigiendo la versión vigente) |
| `instagram_basic` | Perfil y media de Instagram |
| `instagram_content_publish` | Publicar en Instagram (la documentación a veces lo escribe `instagram_content_publishing`: usar el nombre que muestre el panel) |
| `instagram_manage_insights` | Estadísticas de Instagram |

Notas:

- Si el usuario tiene el rol en la página **a través del Business Manager**, Meta indica que también hacen falta `ads_management` y `ads_read`. Pedirlos solo si la API devuelve error sin ellos.
- Para publicar, el usuario necesita en la página las tareas `CREATE_CONTENT`, `MANAGE` y `MODERATE`.
- Permisos **futuros, a no pedir ahora**:
  - `pages_manage_engagement` y `instagram_manage_comments` (comentarios, ítem 10 del backlog)
  - `instagram_manage_messages` y `pages_messaging` (mensajes directos, ítem 18)
  - `publish_video` (video en Facebook, ítem 9)
  - Las Stories (ítem 15) usan el mismo `instagram_content_publish`.

### Configuración básica de la app (App settings → Basic)

- **App Domains:** `social.choco.uy`
- **Privacy Policy URL:** `https://social.choco.uy/privacy`
- **User data deletion:** URL de instrucciones `https://social.choco.uy/data-deletion`. Si se usa el callback firmado de Meta, validar el `signed_request` con el App Secret y devolver la URL de estado y el código de confirmación.
- **Terms of Service URL** (opcional): `https://social.choco.uy/terms`
- **Category:** Business; app icon de 1024×1024; email de contacto.
- **Facebook Login for Business → Settings:**
  - Valid OAuth Redirect URIs: `https://social.choco.uy/auth/callback` (exacta)
  - Enforce HTTPS y Strict Mode activados
  - Client OAuth Login activado
  - Web OAuth Login activado
- **Roles de la app:** mi usuario de Facebook como Administrador. Si alguien más va a aprobar, agregarlo como Developer o Tester.

### Requisitos de las cuentas

- La página de Facebook de choco.uy, con mi usuario con control total (Facebook access).
- Instagram como **cuenta profesional (Business o Creator) vinculada a esa página**.
- Si la página exige **Page Publishing Authorization (PPA)**, completarla antes: si no, la API bloquea la publicación.
- La página y el Instagram, asignados al portfolio comercial de la app.

### Tokens

1. OAuth con `config_id` → `code` → token de usuario de corta duración (intercambio del lado del servidor, en el Worker).
2. `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token` → token de usuario de **larga duración (~60 días)**.
3. `GET /me/accounts` con ese token → **token de página sin fecha de caducidad**. Guardar ese, cifrado.
4. `GET /{page-id}?fields=instagram_business_account` → `IG_ID`.
5. Cron diario: `debug_token` sobre el token de página. Se invalida si cambio la contraseña, quito permisos o pierdo el rol; en ese caso, alerta y botón "Reconectar".
6. Alternativa (no para el MVP): token de **System User** del Business Manager, que no caduca. Requiere acceso a Ad Management y posiblemente App Review, así que se descarta por ahora.

### Especificaciones de publicación

**Facebook:**

- Texto o enlace: `POST /{page-id}/feed` (`message`, `link`).
- Foto: `POST /{page-id}/photos` (`url` de R2 o el archivo, más `message`).
- Programado: `published=false` + `scheduled_publish_time` (Unix). **Mínimo 10 minutos y máximo 30 días** desde la llamada. Fuera de ese rango, lo publica el cron.

**Instagram:**

- Pasos:
  1. `POST /{IG_ID}/media` (`image_url`, `caption`) → `creation_id`
  2. `GET /{creation_id}?fields=status_code` → `IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED`
  3. `POST /{IG_ID}/media_publish` (`creation_id`)
- Consultar el estado como máximo una vez por minuto y durante no más de 5 minutos; después, `failed`.
- El contenedor **caduca a las 24 horas**: no crearlo con mucha antelación, sino unos minutos antes de la hora programada.
- La imagen debe seguir accesible por URL pública en el momento de publicar: no borrarla de R2 antes.
- **Imagen:** solo **JPEG**, máximo **8 MB**, relación de aspecto **4:5 a 1.91:1**, ancho de 320 a 1440 px y sRGB. Convertir PNG/WebP a JPEG en el navegador (canvas) antes de subir.
- **Caption:** máximo **2200 caracteres, 30 hashtags y 20 menciones**. Validar en la UI.
- **Carrusel** (backlog): hasta 10 elementos, recortados según la primera imagen; sin caption por elemento.
- **Reels** (backlog): MP4 o MOV, H.264 o HEVC, AAC, de 3 s a 15 min, máximo 300 MB, 9:16 recomendado.
- **Límite:** 100 publicaciones por API cada 24 horas móviles (un carrusel cuenta como 1). Hay documentación que aún dice 50: consultar siempre `GET /{IG_ID}/content_publishing_limit`.

### Métricas (estado tras las bajas de 2025)

- **Instagram:** `impressions` y `plays` están **retirados**; usar `views`, `reach`, `likes`, `comments`, `saved`, `shares` y `total_interactions` (verificar la lista en la referencia de Instagram Media Insights).
  - Las métricas de cuenta se guardan como máximo 90 días en Meta, así que hay que descargarlas cada día.
  - Algunas requieren 100 seguidores o más.
  - Un dato no disponible vuelve como conjunto vacío, no como 0.
- **Facebook:** `page_impressions` y `post_impressions` están **retirados** desde el 2025-11-15; usar `page_media_view` y `post_media_view` (desglose `is_from_ads` / `is_from_followers`).
  - `page_fans` se reemplaza por `page_follows`.
  - Pedir una métrica retirada devuelve un error de métrica inválida: manejarlo sin romper el cron.

### Errores a manejar

- Token inválido o caducado (código 190) → marcar la cuenta como "reconexión requerida" y avisar por email.
- Límite de llamadas (códigos 4, 17, 32 y 613) → backoff y reintento en el siguiente cron.
- Permiso faltante (código 10 o 200) → `failed`, con el mensaje que indique qué permiso falta.
- Instagram con `ERROR` o `EXPIRED` → `failed` con el detalle; se puede reintentar creando un contenedor nuevo.

## IMPORTANTE

No empieces creando recursos. Primero haz una **AUDITORÍA** de solo lectura.

Comprueba:

1. Versiones de Node, npm y Wrangler (si Wrangler está desactualizado, proponer usar `npx wrangler@<versión>` local al proyecto en vez del global).
2. `wrangler whoami`: cuenta, plan Workers Paid y permisos del token u OAuth. Si no hay sesión, dime que haga `wrangler login` yo.
3. Que la zona choco.uy esté en la cuenta y su estado.
4. Registros DNS existentes para `social` y `media` en choco.uy; si alguno existe (incluido un túnel cloudflared), **detente y pregunta**.
5. Workers, rutas y Custom Domains existentes que puedan entrar en conflicto.
6. Que R2 esté habilitado; buckets existentes.
7. Equipo de Zero Trust / Access existente (team domain) y aplicaciones de Access ya configuradas.
8. Si AI Gateway está disponible.
9. Qué ofrece choco.uy como fuente de contenido (sitemap, RSS, catálogo, API), solo leyendo páginas públicas y sin scraping masivo.
10. Que la sección **CONFIGURACIÓN DE META** siga vigente, contrastándola con la documentación oficial actual:
    - versión de Graph API
    - nombres de los casos de uso y de los permisos
    - límites de publicación de Instagram
    - métricas retiradas
    - requisitos para pasar la app a Live

    Reporta cualquier diferencia antes de seguir.
11. Documentación **actual** de Cloudflare: límites de Workers Paid (CPU, subrequests, Cron Triggers), D1 (tamaño, Time Travel) y R2.
12. Cualquier otro riesgo.

No crees, borres ni modifiques nada durante la auditoría.

Después de la auditoría:

1. Presenta un resumen del estado actual.
2. Presenta los riesgos.
3. Presenta el plan exacto.
4. Indica qué comandos ejecutarás.
5. Espera confirmación antes de crear recursos en Cloudflare, tocar DNS o Access, o hacer deploy.

## FASES

### FASE 1 — Proyecto base

- Scaffold mínimo en `G:\chocoSocial_IA\app` (TypeScript, Hono, `wrangler.jsonc`), con nombre de Worker `misocial-ia`.
- Git con `.gitignore` que excluya `.dev.vars`, `.wrangler/`, `node_modules/` y `../backups`.
- Ruta `/health`.
- Validar con `wrangler dev` en local y `tsc --noEmit`.

### FASE 2 — Recursos Cloudflare (con confirmación)

- Crear la base D1 `misocial-ia` y la migración inicial.
- Crear el bucket R2 `misocial-ia-media` con dominio `media.choco.uy`.
- Desplegar el Worker con Custom Domain `social.choco.uy` y `workers_dev: false`.
- Crear la aplicación de Access con las excepciones indicadas; dame los pasos si requieren el panel.
- Validar: HTTPS en ambos dominios, que Access pide login en `/`, que `/health` es público y que no existe una URL `workers.dev`.

### FASE 3 — Meta Developer (manual, guiado)

No me pidas contraseñas ni secretos por chat. Guíame paso a paso, según la sección **CONFIGURACIÓN DE META**, en este orden, y valida cada paso antes del siguiente:

1. Verificar los requisitos de las cuentas: Instagram profesional vinculado, PPA y activos en el portfolio comercial.
2. Antes, publicar en el Worker `/privacy`, `/data-deletion` y `/terms` con texto real para choco.uy (qué datos se guardan: tokens y contenido de los posts; cómo pedir la eliminación).
3. Crear la app (Business), agregar los dos casos de uso y Facebook Login for Business con su Configuration.
4. Completar App settings → Basic y las URIs de redirección.
5. Cargar los secrets yo mismo:
   - `wrangler secret put META_APP_ID`
   - `wrangler secret put META_APP_SECRET`
   - `wrangler secret put META_CONFIG_ID`
   - `wrangler secret put TOKEN_ENC_KEY`

   Indícame cómo generar `TOKEN_ENC_KEY` localmente (32 bytes aleatorios en base64) sin que aparezca en la salida. `META_API_VERSION` va como variable no secreta en `wrangler.jsonc`.
6. Probar en modo desarrollo con Graph API Explorer (`me/accounts` e `instagram_business_account`).
7. Pasar la app a **Live** después de borrar los posts de prueba. Validar desde una sesión sin rol (ventana de incógnito sin login, o una cuenta sin rol) que un post es público con su imagen.

### FASE 4 — OAuth y tokens

- Botón "Conectar Meta" en la UI → diálogo OAuth de Facebook Login for Business con `config_id` (sin `scope`).
- Seguir los pasos 1–4 de **Tokens**: token de larga duración, token de página sin caducidad e `IG_ID`.
- Verificar que se concedieron todos los permisos (`/me/permissions`); si falta alguno, mostrar cuál.
- Guardar los tokens cifrados en D1.
- Comprobar la validez de los tokens (`debug_token`) en el cron diario y mostrar alerta en la UI si caducan.
- Parámetro `state` anti-CSRF en OAuth.
- La conexión la hago yo en el navegador; guíame.

### FASE 5 — Facebook

Publicación inmediata y programada nativa, verificando ambas en la página real.

### FASE 6 — Instagram

Flujo en dos pasos por cron. Publicación inmediata y programada, verificando ambas en la cuenta real y mostrando el límite disponible.

### FASE 7 — Aprobación

UI con:

- lista por estado
- calendario simple
- vista previa FB e IG
- subida de imágenes a R2 con validación
- edición, aprobar con fecha, rechazar
- historial de auditoría
- panel de `job_runs` y errores

Incluye también (MVP):

- **Un borrador, dos versiones:** texto para Facebook y texto para Instagram, editables por separado.
- **Rechazo con motivo:** queda guardado y se usa como contexto para que la IA aprenda el tono.

Tests de la regla inviolable, la idempotencia o el reclamo atómico, y el flujo de Instagram en dos pasos (mockeando Meta).

### FASE 8 — Mi@Social_ia (generación con IA)

- Definir conmigo la fuente de contenido de choco.uy.
- Claude (Anthropic API) vía AI Gateway; consultar el modelo vigente y sus costos en la documentación oficial, y proponer uno equilibrado en costo y calidad. `ANTHROPIC_API_KEY` como secret.
- Prompts de marca versionados en `app/prompts/`.
- La IA **solo crea borradores**; nunca cambia estados.
- Registrar el costo en tokens por borrador.

### FASE 9 — Estadísticas

El cron diario descarga los insights de cada publicación y de la cuenta a D1. Panel simple en la UI con exportación CSV.

### FASE 10 — Operación

- Scripts y documentación.
- **Alertas por email (MVP)** con Cloudflare Email Service: borradores pendientes de aprobar, posts en `failed` y tokens de Meta por caducar.
- Validación final de punta a punta.

## BACKLOG DE FUNCIONALIDADES (después del MVP)

No implementar nada de esto hasta que las fases 1–10 estén validadas y yo lo confirme. Antes de cada bloque, presenta un mini plan (tablas D1, permisos de Meta, costo estimado) y espera confirmación. Diseña el modelo de datos del MVP para que estas funciones no obliguen a rehacerlo.

### Bloque A — Rápidas y de alto valor

1. **Variantes A/B:** la IA propone 2 o 3 textos y elijo o mezclo.
2. **Biblioteca de hashtags y frases** por categoría (bombones, regalos, fechas especiales), reutilizada por la IA.
3. **Calendario de fechas comerciales de Uruguay** (San Valentín, Pascua, Día de la Madre, Día del Padre, Día del Niño, Navidad, etc.), editable. Un cron genera borradores N días antes de cada fecha.
4. **Post desde un producto de choco.uy:** elijo un producto del catálogo y la IA arma el post con foto, precio y enlace.
5. **Duplicar o reprogramar** posts que funcionaron bien.

### Bloque B — Prioridad media

6. **Mejor horario para publicar,** calculado con las estadísticas propias (alcance por día y hora). Se sugiere la fecha al aprobar.
7. **Ranking de contenido** por producto, formato y texto, que se pasa a la IA como contexto.
8. **Carruseles de Instagram** (varias imágenes).
9. **Reels y video** en R2, con publicación por API (procesamiento más lento; el cron ya es de dos pasos).
10. **Comentarios:** leerlos y sugerir respuestas con IA; **responder solo con aprobación humana.** Requiere permisos adicionales de Meta.
11. **Enlaces con UTM** automáticos hacia choco.uy, para medir visitas y ventas por post.
12. **Campañas:** agrupar varios posts con fechas bajo una campaña (por ejemplo "Pascua 2027"), con métricas agregadas.
13. **Roles editor/aprobador** mediante grupos de Access; segundo aprobador opcional.

### Bloque C — Más adelante

14. **Generación o edición de imágenes con IA** a partir de fotos reales de producto, sin alterar el aspecto del producto y siempre con aprobación.
15. **Stories de Instagram,** si la API vigente lo permite.
16. **Resumen semanal por email:** qué se publicó, cómo rindió y qué propone la IA para la semana siguiente.
17. **Integración con stock o ventas de choco.uy:** no promocionar productos agotados y priorizar los de mucho stock (definir conmigo la fuente: API, feed o export).
18. **Mensajes directos** de Instagram y Messenger con respuestas sugeridas y aprobación humana (otra API y otro App Review).
19. **Más redes** (Google Business Profile, TikTok, LinkedIn) reutilizando el mismo flujo de borrador y aprobación.

Permisos de Meta: en la FASE 3, lista también los permisos que necesitarán los ítems 10, 15 y 18, pero **solicita en el App Review inicial solo los del MVP.**

## REQUISITOS

- Solo APIs oficiales de Meta: sin Selenium, scraping ni simulación de login.
- No usar Postiz, n8n, servidores, túneles ni Docker.
- No modificar Workers, DNS, túneles ni aplicaciones de Access existentes sin confirmación.
- No guardar secretos en Git (`.dev.vars` ignorado) ni imprimirlos en la salida o en los logs (enmascarar tokens).
- Backup (export D1) antes de cada migración o deploy relevante.
- No ejecutar comandos destructivos (borrar recursos, `d1 time-travel restore`, borrar objetos R2) sin confirmación.
- Código simple, con mínimas dependencias, y tests de la lógica crítica.
- Documentar todos los cambios en `docs/CHANGELOG.md`; crear `README.md`.

## MANTENIMIENTO

Comandos npm (`package.json`) con wrappers `.ps1` en `G:\chocoSocial_IA\scripts\`, sin duplicar lógica:

- `status.ps1` — despliegue activo (`wrangler deployments list`), última ejecución de cada cron y posts pendientes o fallidos (consulta a D1).
- `health.ps1` — `/health` público, estado de los tokens de Meta, errores recientes.
- `backup.ps1` — `wrangler d1 export` a `G:\chocoSocial_IA\backups\` con fecha y rotación, más una copia de R2 por el método más simple con un token de solo lectura (proponer y justificar la herramienta). Indicar también el plazo de D1 Time Travel.
- `restore.ps1` — D1 Time Travel o import desde un export, con confirmación explícita.
- `update.ps1` — backup, tests, migraciones, `wrangler deploy` y health check; documentar `wrangler rollback`.
- `logs.ps1` — `wrangler tail` con filtros.

## AL TERMINAR CADA FASE

1. Validar.
2. Mostrar el resultado.
3. Indicar la siguiente fase.

No declares una fase completada si no fue realmente comprobada. Si la documentación actual de Meta o de Cloudflare contradice este prompt, detente, explica la diferencia y propón la corrección.

Empieza exclusivamente con la AUDITORÍA.
