import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KEEP_DAILY } from "../src/backup/service.ts";
import { tarHeader } from "../src/backup/tar.ts";
import { createTestApp, registerUser, textChannelId, type TestApp, type TestUser } from "./helpers.ts";
import { multipart, png, webpLossless } from "./images.ts";

let t: TestApp;
let admin: TestUser;
let member: TestUser;
let work: string;

beforeEach(async () => {
  t = await createTestApp();
  admin = await registerUser(t, "admin", "chefe");
  member = await registerUser(t, "member", "amigo");
  work = mkdtempSync(path.join(tmpdir(), "resenha-backup-"));
});
afterEach(async () => {
  await t.close();
  rmSync(work, { recursive: true, force: true });
});

async function seed() {
  const photo = png(64, 40);
  const up = multipart("foto.png", photo);
  const att = (
    await t.app.inject({ method: "POST", url: "/api/uploads", headers: { ...up.headers, cookie: member.cookie }, payload: up.payload })
  ).json().attachment;
  await t.app.inject({
    method: "POST",
    url: `/api/channels/${textChannelId(t)}/messages`,
    headers: { cookie: member.cookie },
    payload: { content: "mensagem que precisa sobreviver", attachmentIds: [att.id] },
  });
  const avatar = webpLossless(256, 256);
  const av = multipart("eu.webp", avatar);
  await t.app.inject({ method: "POST", url: "/api/me/avatar", headers: { ...av.headers, cookie: member.cookie }, payload: av.payload });
  return { attachmentId: att.id as string, photo, avatar };
}

const download = (user: TestUser, headers: Record<string, string> = {}) =>
  t.app.inject({ method: "GET", url: "/api/admin/backup", headers: { cookie: user.cookie, ...headers } });

describe("backup completo", () => {
  it("baixa um .tar que o tar do sistema extrai, com banco, anexos e fotos", async () => {
    const { attachmentId, photo, avatar } = await seed();
    const res = await download(admin, { "sec-fetch-site": "same-origin" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/x-tar");
    expect(String(res.headers["content-disposition"])).toMatch(/attachment; filename="resenha-backup-\d{4}-\d{2}-\d{2}\.tar"/);

    const tarFile = path.join(work, "backup.tar");
    writeFileSync(tarFile, res.rawPayload);
    const listing = execFileSync("tar", ["-tf", tarFile], { encoding: "utf8" }).trim().split("\n");
    expect(listing).toContain("resenha.db");
    expect(listing).toContain(`uploads/${attachmentId}`);

    const out = path.join(work, "restaurado");
    execFileSync("mkdir", ["-p", out]);
    execFileSync("tar", ["-xf", tarFile, "-C", out]);
    expect(readFileSync(path.join(out, "uploads", attachmentId)).equals(photo)).toBe(true);
    const [avatarFile] = readdirSync(path.join(out, "avatars"));
    expect(readFileSync(path.join(out, "avatars", avatarFile!)).equals(avatar)).toBe(true);

    const restored = new DatabaseSync(path.join(out, "resenha.db"));
    const msg = restored.prepare("SELECT content FROM messages").get() as { content: string };
    expect(msg.content).toBe("mensagem que precisa sobreviver");
    expect((restored.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(2);
    restored.close();

    // a cópia temporária do banco não fica para trás
    expect(readdirSync(t.ctx.config.backupsDir).filter((n) => n.startsWith("download-"))).toEqual([]);
    expect((await t.app.inject({ method: "GET", url: "/api/admin/backup/info", headers: { cookie: admin.cookie } })).json().lastDownloadAt)
      .toBeTypeOf("number");
  });

  it("só administradores, e só a partir do próprio app", async () => {
    expect((await download(member)).statusCode).toBe(403);
    expect((await download(admin, { "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: "/api/admin/backup/info", headers: { cookie: member.cookie } })).statusCode).toBe(403);
  });

  it("informa tamanho, disco e se nunca foi baixado", async () => {
    await seed();
    const info = (await t.app.inject({ method: "GET", url: "/api/admin/backup/info", headers: { cookie: admin.cookie } })).json();
    expect(info.lastDownloadAt).toBeNull();
    expect(info.totalBytes).toBeGreaterThan(4096);
    expect(info.disk.total).toBeGreaterThan(info.disk.free);
  });
});

describe("cópia diária do banco", () => {
  it("uma por dia, guardando só as últimas", async () => {
    const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
    expect(await t.ctx.backups.ensureDaily(day(1))).toBe("resenha-2026-10-01.db");
    expect(await t.ctx.backups.ensureDaily(day(1))).toBeNull(); // mesmo dia: não repete
    for (let d = 2; d <= 10; d++) await t.ctx.backups.ensureDaily(day(d));
    const names = (await t.ctx.backups.listSnapshots()).map((s) => s.name);
    expect(names).toHaveLength(KEEP_DAILY);
    expect(names[0]).toBe("resenha-2026-10-10.db");
    expect(names.at(-1)).toBe("resenha-2026-10-04.db");

    const copy = new DatabaseSync(path.join(t.ctx.config.backupsDir, names[0]!));
    expect((copy.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(2);
    copy.close();
  });
});

describe("cabeçalho tar", () => {
  it("tem a soma de verificação que o tar confere", () => {
    const h = tarHeader({ name: "uploads/x", type: "file", size: 1234, mtime: 1_700_000_000_000 });
    expect(h.length).toBe(512);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i]!;
    expect(parseInt(h.subarray(148, 154).toString("latin1"), 8)).toBe(sum);
    expect(h.subarray(124, 135).toString("latin1")).toBe((1234).toString(8).padStart(11, "0"));
  });

  it("recusa nome longo demais em vez de gerar arquivo quebrado", () => {
    expect(() => tarHeader({ name: "x".repeat(101), type: "file", size: 1, mtime: 0 })).toThrow();
  });
});
