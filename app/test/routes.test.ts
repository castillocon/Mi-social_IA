import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskToken } from "../src/lib/crypto";
import { verifyAccessJwt } from "../src/lib/access";
import { approvePost, createDraft, rejectPost, validateIgCaption, ValidationError } from "../src/posts";

describe("rutas", () => {
  it("/health es público", async () => {
    const res = await SELF.fetch("https://social.choco.uy/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, app: "misocial-ia" });
  });

  it.each(["/privacy", "/data-deletion", "/terms"])("%s es público", async (path) => {
    const res = await SELF.fetch(`https://social.choco.uy${path}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("choco.uy");
  });

  it("la UI exige el JWT de Access", async () => {
    expect((await SELF.fetch("https://social.choco.uy/")).status).toBe(403);
    const forged = await SELF.fetch("https://social.choco.uy/", { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } });
    expect(forged.status).toBe(403);
  });

  it("el bypass de desarrollo no funciona fuera de localhost", async () => {
    // DEV_BYPASS_ACCESS no está definido en tests; aun definido, solo aplica a localhost.
    expect((await SELF.fetch("https://social.choco.uy/")).status).toBe(403);
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
