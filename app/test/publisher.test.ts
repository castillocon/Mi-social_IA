import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MetaError } from "../src/lib/meta";
import { createDraft, isPublishable } from "../src/posts";
import { runPublisher } from "../src/publisher";
import { APPROVER, approvedPost, connectAccount, fakeMeta, minutes, postStatus, resetDb, target } from "./helpers";

const T0 = new Date("2026-10-09T15:00:00.000Z");

beforeEach(async () => {
  await resetDb();
  await connectAccount();
});

describe("regla inviolable: nada se publica sin aprobación registrada", () => {
  it("la base rechaza un post aprobado sin aprobador o sin fecha de aprobación", async () => {
    const insert = (approvedBy: string | null, approvedAt: string | null) =>
      env.DB.prepare(
        `INSERT INTO posts (id, status, scheduled_at, approved_by, approved_at, created_by, created_at, updated_at)
         VALUES (?, 'approved', ?, ?, ?, 'x', ?, ?)`,
      )
        .bind(crypto.randomUUID(), T0.toISOString(), approvedBy, approvedAt, T0.toISOString(), T0.toISOString())
        .run();
    await expect(insert(null, T0.toISOString())).rejects.toThrow();
    await expect(insert("", T0.toISOString())).rejects.toThrow();
    await expect(insert(APPROVER, null)).rejects.toThrow();
  });

  it("el cron no publica un borrador aunque tenga un target pendiente", async () => {
    const id = await createDraft(env.DB, "editor@choco.uy", { fbText: "x", igText: "x", imageKey: "k.jpg" }, T0);
    await env.DB.prepare(
      "INSERT INTO post_targets (post_id, network, status, next_attempt_at, updated_at) VALUES (?, 'facebook', 'pending', ?, ?)",
    )
      .bind(id, T0.toISOString(), T0.toISOString())
      .run();
    const meta = fakeMeta();
    const summary = await runPublisher({ env, meta: meta.client, now: minutes(T0, 5) });
    expect(summary.claimed).toBe(0);
    expect(meta.calls).toHaveLength(0);
    expect(await postStatus(id)).toBe("draft");
  });

  it("isPublishable exige estado, aprobador y fecha", () => {
    const ok = { status: "approved" as const, approved_by: APPROVER, approved_at: T0.toISOString() };
    expect(isPublishable(ok)).toBe(true);
    expect(isPublishable({ ...ok, approved_by: " " })).toBe(false);
    expect(isPublishable({ ...ok, approved_by: null })).toBe(false);
    expect(isPublishable({ ...ok, approved_at: null })).toBe(false);
    expect(isPublishable({ ...ok, status: "draft" })).toBe(false);
    expect(isPublishable({ ...ok, status: "rejected" })).toBe(false);
  });
});

describe("reclamo atómico", () => {
  it("dos ejecuciones simultáneas publican una sola vez", async () => {
    const id = await approvedPost(["facebook"], minutes(T0, -1), T0);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const meta = fakeMeta({
      fbPublish: async () => {
        await gate;
        return { id: "FBPOST" };
      },
    });
    const a = runPublisher({ env, meta: meta.client, now: T0 });
    const b = runPublisher({ env, meta: meta.client, now: T0 });
    setTimeout(release, 20);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.claimed + rb.claimed).toBe(1);
    expect(meta.count("fbPublish")).toBe(1);
    expect(await postStatus(id)).toBe("published");
    expect((await target(id, "facebook"))?.external_id).toBe("FBPOST");
  });
});

describe("Facebook", () => {
  it("publica de inmediato si la fecha ya pasó", async () => {
    const id = await approvedPost(["facebook"], minutes(T0, -1), T0);
    const meta = fakeMeta();
    await runPublisher({ env, meta: meta.client, now: T0 });
    expect(meta.calls[0]?.args[2]).toMatchObject({ message: "Hola FB", imageUrl: "https://media.choco.uy/abc123.jpg" });
    expect(meta.calls[0]?.args[2]).not.toHaveProperty("scheduledPublishTime");
    expect(await postStatus(id)).toBe("published");
  });

  it("programa de forma nativa entre 10 minutos y 30 días y luego verifica", async () => {
    const when = minutes(T0, 120);
    const id = await approvedPost(["facebook"], when, T0);
    const meta = fakeMeta();
    await runPublisher({ env, meta: meta.client, now: T0 });
    expect(meta.calls[0]?.args[2]).toMatchObject({ scheduledPublishTime: Math.floor(when.getTime() / 1000) });
    expect((await target(id, "facebook"))?.status).toBe("scheduled_native");
    expect(await postStatus(id)).toBe("scheduled");

    await runPublisher({ env, meta: meta.client, now: minutes(T0, 60) }); // aún no toca
    expect(meta.count("fbIsPublished")).toBe(0);
    await runPublisher({ env, meta: meta.client, now: minutes(T0, 123) });
    expect(meta.count("fbPublish")).toBe(1);
    expect(await postStatus(id)).toBe("published");
  });

  it("si faltan menos de 10 minutos espera y lo publica el cron", async () => {
    const id = await approvedPost(["facebook"], minutes(T0, 5), T0);
    const meta = fakeMeta();
    await runPublisher({ env, meta: meta.client, now: T0 });
    expect(meta.count("fbPublish")).toBe(0);
    await runPublisher({ env, meta: meta.client, now: minutes(T0, 5) });
    expect(meta.count("fbPublish")).toBe(1);
    expect(await postStatus(id)).toBe("published");
  });
});

describe("Instagram en dos pasos", () => {
  it("crea el contenedor, espera FINISHED y publica en ejecuciones distintas", async () => {
    const when = minutes(T0, 3);
    const id = await approvedPost(["instagram"], when, T0);
    const meta = fakeMeta();
    meta.igStatuses.push("IN_PROGRESS", "FINISHED");

    await runPublisher({ env, meta: meta.client, now: T0 });
    expect(meta.count("igCreateContainer")).toBe(1);
    expect(meta.count("igPublish")).toBe(0);
    expect((await target(id, "instagram"))?.status).toBe("ig_container_created");
    expect(await postStatus(id)).toBe("scheduled");

    await runPublisher({ env, meta: meta.client, now: minutes(T0, 1) }); // antes de la hora: no consulta
    expect(meta.count("igContainerStatus")).toBe(0);

    await runPublisher({ env, meta: meta.client, now: when }); // IN_PROGRESS
    expect(meta.count("igPublish")).toBe(0);
    expect((await target(id, "instagram"))?.status_checks).toBe(1);

    await runPublisher({ env, meta: meta.client, now: minutes(when, 1) }); // FINISHED
    expect(meta.count("igPublishingQuota")).toBe(1);
    expect(meta.count("igPublish")).toBe(1);
    expect(meta.count("igCreateContainer")).toBe(1);
    expect(await postStatus(id)).toBe("published");
    expect((await target(id, "instagram"))?.external_id).toBe("IGMEDIA1");
  });

  it("pasa a failed si el contenedor no termina en 5 consultas", async () => {
    const id = await approvedPost(["instagram"], T0, T0);
    const meta = fakeMeta({ igContainerStatus: async () => ({ status: "IN_PROGRESS" }) });
    for (let m = 0; m <= 6; m++) await runPublisher({ env, meta: meta.client, now: minutes(T0, m) });
    expect(meta.count("igContainerStatus")).toBe(5);
    expect(meta.count("igPublish")).toBe(0);
    expect(await postStatus(id)).toBe("failed");
  });

  it("no publica si se alcanzó el límite diario", async () => {
    const id = await approvedPost(["instagram"], T0, T0);
    const meta = fakeMeta({ igPublishingQuota: async () => ({ used: 100, total: 100 }) });
    await runPublisher({ env, meta: meta.client, now: T0 });
    await runPublisher({ env, meta: meta.client, now: minutes(T0, 1) });
    expect(meta.count("igPublish")).toBe(0);
    expect((await target(id, "instagram"))?.last_error).toMatch(/Límite/);
  });

  it("ERROR del contenedor deja el post en failed con el detalle", async () => {
    const id = await approvedPost(["instagram"], T0, T0);
    const meta = fakeMeta({ igContainerStatus: async () => ({ status: "ERROR", detail: "Formato inválido" }) });
    await runPublisher({ env, meta: meta.client, now: T0 });
    await runPublisher({ env, meta: meta.client, now: minutes(T0, 1) });
    expect((await target(id, "instagram"))?.last_error).toMatch(/ERROR: Formato inválido/);
    expect(await postStatus(id)).toBe("failed");
  });
});

describe("errores de Meta", () => {
  it("límite de llamadas: reintenta con backoff", async () => {
    const id = await approvedPost(["facebook"], minutes(T0, -1), T0);
    const meta = fakeMeta({ fbPublish: async () => Promise.reject(new MetaError("Too many calls", 4)) });
    await runPublisher({ env, meta: meta.client, now: T0 });
    const t = await target(id, "facebook");
    expect(t).toMatchObject({ status: "pending", attempts: 1 });
    expect(new Date(String(t?.next_attempt_at)).getTime()).toBeGreaterThan(T0.getTime());
  });

  it("permiso faltante: failed sin reintentar", async () => {
    const id = await approvedPost(["facebook"], minutes(T0, -1), T0);
    const meta = fakeMeta({ fbPublish: async () => Promise.reject(new MetaError("Requires pages_manage_posts", 200)) });
    await runPublisher({ env, meta: meta.client, now: T0 });
    expect((await target(id, "facebook"))?.last_error).toMatch(/pages_manage_posts/);
    expect(await postStatus(id)).toBe("failed");
  });

  it("token inválido (190): marca la cuenta para reconectar", async () => {
    await approvedPost(["facebook"], minutes(T0, -1), T0);
    const meta = fakeMeta({ fbPublish: async () => Promise.reject(new MetaError("Session expired", 190)) });
    await runPublisher({ env, meta: meta.client, now: T0 });
    const acc = await env.DB.prepare("SELECT status FROM meta_accounts").first<{ status: string }>();
    expect(acc?.status).toBe("reconnect_required");
    // Sin cuenta activa, el cron no intenta publicar.
    const r = await runPublisher({ env, meta: meta.client, now: minutes(T0, 30) });
    expect(r).toMatchObject({ skipped: "sin cuenta de Meta activa" });
  });

  it("tras MAX_ATTEMPTS fallos pasa a failed", async () => {
    const id = await approvedPost(["facebook"], minutes(T0, -1), T0);
    const meta = fakeMeta({ fbPublish: async () => Promise.reject(new Error("network")) });
    for (let m = 0; m < 200; m += 10) await runPublisher({ env, meta: meta.client, now: minutes(T0, m) });
    expect(meta.count("fbPublish")).toBe(5);
    expect(await postStatus(id)).toBe("failed");
  });
});
