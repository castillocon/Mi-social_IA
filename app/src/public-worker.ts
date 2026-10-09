// Worker público `misocial-ia-public`: solo páginas legales, /health e imágenes para Meta.
// La app (misocial-ia) queda entera detrás de Cloudflare Access; workers.dev no permite excepciones por ruta.
import { Hono } from "hono";
import type { AppEnv } from "./lib/access";
import { securityHeaders } from "./lib/headers";
import { publicRoutes } from "./routes/public";

export const publicApp = new Hono<AppEnv>();
publicApp.use("*", securityHeaders);
publicApp.route("/", publicRoutes);

export default { fetch: publicApp.fetch } satisfies ExportedHandler<Env>;
