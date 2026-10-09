import { Hono } from "hono";
import { requireAccess, type AppEnv } from "./lib/access";
import { withJobRun } from "./lib/audit";
import { GraphClient } from "./lib/meta";
import { runPublisher } from "./publisher";
import { publicRoutes } from "./routes/public";
import { uiRoutes } from "./routes/ui";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
});

app.route("/", publicRoutes);
app.use("*", requireAccess); // todo lo que sigue exige Cloudflare Access
app.route("/", uiRoutes);

const PUBLISHER_CRON = "* * * * *";

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    if (controller.cron === PUBLISHER_CRON) {
      ctx.waitUntil(
        withJobRun(env.DB, "publisher", () => runPublisher({ env, meta: new GraphClient(env.META_API_VERSION) })),
      );
    } else {
      // Tareas diarias (debug_token, estadísticas, alertas): FASES 4, 9 y 10.
      ctx.waitUntil(withJobRun(env.DB, "daily", async () => ({ pending: "sin tareas diarias todavía" })));
    }
  },
} satisfies ExportedHandler<Env>;
