// Validación del JWT de Cloudflare Access dentro del Worker (defensa en profundidad).
import type { MiddlewareHandler } from "hono";

interface Jwk extends JsonWebKey {
  kid: string;
}

let jwksCache: { url: string; keys: Jwk[]; fetchedAt: number } | null = null;

const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function getKeys(certsUrl: string, fetchFn: typeof fetch, force = false): Promise<Jwk[]> {
  if (!force && jwksCache?.url === certsUrl && Date.now() - jwksCache.fetchedAt < 60 * 60_000) return jwksCache.keys;
  const res = await fetchFn(certsUrl);
  if (!res.ok) throw new Error(`No se pudieron obtener las claves de Access (${res.status})`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { url: certsUrl, keys, fetchedAt: Date.now() };
  return keys;
}

export interface AccessIdentity {
  email: string;
}

/** Devuelve la identidad si el JWT es válido para este equipo y esta aplicación; null en cualquier otro caso. */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string,
  now = Date.now(),
  fetchFn: typeof fetch = fetch,
): Promise<AccessIdentity | null> {
  if (!token || !teamDomain || !aud) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;

  const issuer = teamDomain.replace(/\/$/, "");
  let keys = await getKeys(`${issuer}/cdn-cgi/access/certs`, fetchFn);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getKeys(`${issuer}/cdn-cgi/access/certs`, fetchFn, true); // rotación de claves
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) return null;

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const nowSec = Math.floor(now / 1000);
  if (!auds.includes(aud)) return null;
  if (payload.iss !== issuer) return null;
  if (typeof payload.exp !== "number" || payload.exp < nowSec) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) return null;
  if (!payload.email) return null;
  return { email: payload.email.toLowerCase() };
}

export type AppEnv = { Bindings: Env; Variables: { user: AccessIdentity } };

/** Exige un JWT de Access válido. En local (`wrangler dev` en localhost) se puede omitir con DEV_BYPASS_ACCESS. */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_BYPASS_ACCESS === "true" && (host === "localhost" || host === "127.0.0.1")) {
    c.set("user", { email: c.env.DEV_USER_EMAIL ?? "dev@localhost" });
    return next();
  }
  const token = c.req.header("Cf-Access-Jwt-Assertion") ?? "";
  const identity = await verifyAccessJwt(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD).catch(() => null);
  if (!identity) return c.text("Acceso denegado", 403);
  c.set("user", identity);
  return next();
};
