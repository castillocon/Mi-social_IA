// Rutas públicas (excluidas de Cloudflare Access): /health, /privacy, /data-deletion, /terms y /media/*.
import { Hono } from "hono";
import type { AppEnv } from "../lib/access";
import { audit } from "../lib/audit";
import { Layout } from "./layout";

export const publicRoutes = new Hono<AppEnv>();

const CONTACT = "chocouycorreo@gmail.com";

publicRoutes.get("/health", async (c) => {
  let db = "ok";
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch {
    db = "error";
  }
  const configured = !c.env.PUBLIC_BASE_URL.includes("CAMBIAR") && c.env.ACCESS_AUD !== "";
  return c.json(
    { ok: db === "ok", app: "misocial-ia", db, configured, time: new Date().toISOString() },
    db === "ok" ? 200 : 503,
  );
});

// Imágenes aprobadas para Meta. Solo claves aleatorias de 128 bits (no adivinables) en JPEG.
export const MEDIA_KEY = /^[a-f0-9]{32}\.jpg$/;

publicRoutes.get("/media/:key", async (c) => {
  const key = c.req.param("key");
  if (!MEDIA_KEY.test(key)) return c.notFound();
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(object.size),
      "Cache-Control": "public, max-age=86400, immutable",
      ETag: object.httpEtag,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

publicRoutes.get("/privacy", (c) =>
  c.html(
    <Layout title="Política de privacidad">
      <h1>Política de privacidad de Mi@Social_ia</h1>
      <p>
        Mi@Social_ia es una herramienta interna de choco.uy para preparar, aprobar y publicar contenido en la página de
        Facebook y la cuenta de Instagram de choco.uy. No está abierta al público ni gestiona cuentas de terceros.
      </p>
      <h2>Qué datos guardamos</h2>
      <ul>
        <li>Los tokens de acceso de Meta de la página de choco.uy, cifrados (AES-GCM), para poder publicar.</li>
        <li>Los identificadores de la página de Facebook y de la cuenta de Instagram de choco.uy.</li>
        <li>El contenido de los posts (textos, imágenes, fechas) y las estadísticas de esas publicaciones.</li>
        <li>El email de las personas de choco.uy que aprueban o rechazan publicaciones, con fecha y hora.</li>
      </ul>
      <p>No recopilamos datos de seguidores ni de otros usuarios de Facebook o Instagram, y no vendemos ni compartimos datos.</p>
      <h2>Dónde se guardan</h2>
      <p>En la infraestructura de Cloudflare (Workers, D1 y R2) asociada a la cuenta de choco.uy.</p>
      <h2>Eliminación</h2>
      <p>
        Ver <a href="/data-deletion">instrucciones de eliminación de datos</a>. Contacto: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </Layout>,
  ),
);

publicRoutes.get("/data-deletion", (c) => {
  const code = c.req.query("code");
  return c.html(
    <Layout title="Eliminación de datos">
      <h1>Eliminación de datos</h1>
      {code ? (
        <p>
          Recibimos tu solicitud. Código de confirmación: <strong>{code}</strong>. Los datos se eliminan en un plazo máximo de 30 días.
        </p>
      ) : null}
      <p>Para eliminar los datos que Mi@Social_ia (la herramienta de redes sociales de choco.uy) guarda sobre tu cuenta de Meta:</p>
      <ol>
        <li>
          En Facebook, entrá a <em>Configuración → Seguridad e inicio de sesión → Apps y sitios web</em> (o{" "}
          <em>Integraciones comerciales</em>), buscá la app y eliminala. Meta nos avisa y borramos los tokens asociados.
        </li>
        <li>
          O escribinos a <a href={`mailto:${CONTACT}`}>{CONTACT}</a> pidiendo la eliminación. Borramos tokens, identificadores y
          contenido asociados en un plazo máximo de 30 días y te confirmamos por email.
        </li>
      </ol>
    </Layout>,
  );
});

// Callback firmado de Meta (signed_request). Devuelve la URL de estado y el código de confirmación.
publicRoutes.post("/data-deletion", async (c) => {
  const form = await c.req.parseBody();
  const signed = typeof form.signed_request === "string" ? form.signed_request : "";
  const payload = await parseSignedRequest(signed, c.env.META_APP_SECRET ?? "");
  if (!payload) return c.json({ error: "signed_request inválido" }, 400);
  const code = crypto.randomUUID();
  // Solo guardamos tokens de página: al revocarse la app se desactivan y se borran.
  await c.env.DB.prepare("DELETE FROM meta_accounts").run();
  await audit(c.env.DB, "meta:data_deletion", "data_deletion.request", "meta_account", null, { code });
  return c.json({ url: `${c.env.PUBLIC_BASE_URL}/data-deletion?code=${code}`, confirmation_code: code });
});

publicRoutes.get("/terms", (c) =>
  c.html(
    <Layout title="Términos de servicio">
      <h1>Términos de servicio</h1>
      <p>
        Mi@Social_ia es de uso exclusivo del equipo de choco.uy para gestionar sus propias redes sociales. El acceso está
        restringido a personas autorizadas. Todo contenido generado por IA requiere aprobación humana antes de publicarse.
      </p>
      <p>
        Contacto: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </Layout>,
  ),
);

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

export async function parseSignedRequest(signed: string, appSecret: string): Promise<Record<string, unknown> | null> {
  const [sig, body] = signed.split(".");
  if (!sig || !body || !appSecret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  try {
    const ok = await crypto.subtle.verify("HMAC", key, b64url(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64url(body))) as Record<string, unknown>;
    return payload.algorithm === "HMAC-SHA256" ? payload : null;
  } catch {
    return null;
  }
}
