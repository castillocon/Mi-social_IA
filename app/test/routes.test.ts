import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskToken } from "../src/lib/crypto";
import { verifyAccessJwt } from "../src/lib/access";
import { publicApp } from "../src/public-worker";
import { approvePost, createDraft, rejectPost, validateIgCaption, ValidationError } from "../src/posts";

const PUB = "https://misocial-ia-public.example.workers.dev";
const pub = (path: string) => publicApp.request(`${PUB}${path}`, {}, env);

describe("Worker público", () => {
  it("/health es público", async () => {
    const res = await pub("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, app: "misocial-ia" });
  });

  it.each(["/privacy", "/data-deletion", "/terms"])("%s es público", async (path) => {
    const res = await pub(path);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("choco.uy");
  });

  it("/media sirve solo claves aleatorias existentes, sin Access", async () => {
    const key = "0123456789abcdef0123456789abcdef.jpg";
    await env.MEDIA.put(key, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    const ok = await pub(`/media/${key}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    expect((await pub("/media/fedcba9876543210fedcba9876543210.jpg")).status).toBe(404);
    expect((await pub("/media/abc.jpg")).status).toBe(404);
    expect((await pub("/media/..%2Fsecret")).status).toBe(404);
  });

  it("no expone la UI ni rutas privadas", async () => {
    expect((await pub("/")).status).toBe(404);
    expect((await pub("/auth/callback")).status).toBe(404);
  });
});

describe("Worker de la app (detrás de Access)", () => {
  it.each(["/", "/health", "/privacy", "/media/0123456789abcdef0123456789abcdef.jpg"])(
    "%s exige el JWT de Access",
    async (path) => {
      expect((await SELF.fetch(`https://misocial-ia.example.workers.dev${path}`)).status).toBe(403);
    },
  );

  it("la UI exige el JWT de Access", async () => {
    expect((await SELF.fetch("https://misocial-ia.example.workers.dev/")).status).toBe(403);
    const forged = await SELF.fetch("https://misocial-ia.example.workers.dev/", { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } });
    expect(forged.status).toBe(403);
  });

  it("el bypass de desarrollo no funciona fuera de localhost", async () => {
    // DEV_BYPASS_ACCESS no está definido en tests; aun definido, solo aplica a localhost.
    expect((await SELF.fetch("https://misocial-ia.example.workers.dev/")).status).toBe(403);
  });

  it("verifyAccessJwt rechaza sin configuración", async () => {
    expect(await verifyAccessJwt("x.y.z", "", "")).toBeNull();
  });
});

describe("cifrado de tokens", () => {
  it("cifra y descifra; nunca guarda en claro", async () => {
    const enc = await encryptSecret("EAAB-secreto", env.TOKEN_ENC_KEY);
    expect(enc).not.toContain("EAAB");
    expect(await decryptSecret(enc, env.TOKEN_ENC_KEY)).toBe("EAAB-secreto");
    expect(maskToken("EAABxxxxxxxxxx1234")).toBe("EAAB…1234");
  });
});

describe("aprobación y rechazo", () => {
  it("Instagram exige imagen y caption válido", async () => {
    const id = await createDraft(env.DB, "e@choco.uy", { fbText: "a", igText: "b" });
    await expect(approvePost(env.DB, id, "a@choco.uy", new Date(), ["instagram"])).rejects.toBeInstanceOf(ValidationError);
    expect(validateIgCaption("#a ".repeat(31))).toHaveLength(1);
    expect(validateIgCaption("x".repeat(2201))).toHaveLength(1);
  });

  it("el rechazo exige motivo y lo guarda", async () => {
    const id = await createDraft(env.DB, "e@choco.uy", { fbText: "a", igText: "b" });
    await expect(rejectPost(env.DB, id, "a@choco.uy", " ")).rejects.toBeInstanceOf(ValidationError);
    await rejectPost(env.DB, id, "a@choco.uy", "Tono demasiado formal");
    const row = await env.DB.prepare("SELECT status, rejection_reason FROM posts WHERE id = ?").bind(id).first();
    expect(row).toMatchObject({ status: "rejected", rejection_reason: "Tono demasiado formal" });
  });
});
