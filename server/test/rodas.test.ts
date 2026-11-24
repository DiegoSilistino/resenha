import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS, openDatabase } from "../src/db.ts";
import { createTestApp, listen, registerUser, TestSocket, type TestApp, type TestUser } from "./helpers.ts";
import { multipart, png } from "./images.ts";

let t: TestApp;
let dono: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeEach(async () => {
  t = await createTestApp();
  dono = await registerUser(t, "admin", "dono");
  bob = await registerUser(t, "member", "bob");
  carol = await registerUser(t, "member", "carol");
});
afterEach(async () => {
  await t.close();
});

const req = (user: TestUser, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie: user.cookie }, ...(payload ? { payload } : {}) });

async function newRoda(owner: TestUser, body: object = {}) {
  const res = await req(owner, "POST", "/api/rodas", { name: "Ranked", template: "jogos", ...body });
  expect(res.statusCode).toBe(201);
  return res.json().roda as { id: string; roles: { id: string; name: string; owner: boolean; isDefault: boolean }[] };
}

const textIn = (rodaId: string) => t.ctx.store.listChannels(rodaId).find((c) => c.kind === "text")!.id;
const post = (user: TestUser, channelId: string, content = "oi") =>
  req(user, "POST", `/api/channels/${channelId}/messages`, { content, attachmentIds: [] });

describe("roda principal", () => {
  it("o primeiro admin vira dono; quem chega por convite entra como Membro", () => {
    const roda = t.ctx.store.rodaById(t.ctx.store.defaultRodaId()!)!;
    const roleName = (id: string) => roda.roles.find((r) => r.id === roda.members[id])?.name;
    expect(roleName(dono.id)).toBe("Dono");
    expect(roleName(bob.id)).toBe("Membro");
  });
});

describe("rodas", () => {
  it("criar: quem cria é dono, vem com as salas do modelo e quem está fora não vê nada", async () => {
    const roda = await newRoda(bob);
    expect(t.ctx.store.listChannels(roda.id).map((c) => c.name)).toEqual(["geral", "clipes", "Ranked", "Casual"]);
    const sala = textIn(roda.id);
    expect((await post(bob, sala)).statusCode).toBe(201);
    expect((await req(carol, "GET", `/api/channels/${sala}/messages`)).statusCode).toBe(404);
    expect((await post(carol, sala)).statusCode).toBe(404);
    expect((await req(carol, "POST", "/api/voice/token", { channelId: t.ctx.store.listChannels(roda.id)[2]!.id })).statusCode).toBe(404);

    const port = await listen(t);
    const carolSocket = await TestSocket.connect(port, carol.cookie);
    const hello = await carolSocket.waitFor("hello");
    expect(hello.channels.map((c) => c.id)).not.toContain(sala);
    expect(hello.rodas.map((r) => r.id)).not.toContain(roda.id);
    carolSocket.close();
  });

  it("convite: entra direto; com aprovação, vira pedido até alguém aprovar", async () => {
    const roda = await newRoda(bob);
    const direct = (await req(bob, "POST", `/api/rodas/${roda.id}/invites`, { expiresInMinutes: 30 })).json().invite;
    expect((await req(carol, "POST", `/api/invites/${direct.code}/join`)).json().status).toBe("joined");
    expect((await post(carol, textIn(roda.id))).statusCode).toBe(201);

    const roda2 = await newRoda(bob, { name: "Fechada" });
    const approval = (await req(bob, "POST", `/api/rodas/${roda2.id}/invites`, { approval: true })).json().invite;
    expect((await req(carol, "POST", `/api/invites/${approval.code}/join`)).json().status).toBe("requested");
    expect((await post(carol, textIn(roda2.id))).statusCode).toBe(404);
    expect(t.ctx.store.rodaById(roda2.id)!.requests).toEqual([carol.id]);
    expect((await req(bob, "POST", `/api/rodas/${roda2.id}/requests/${carol.id}/approve`)).statusCode).toBe(204);
    expect((await post(carol, textIn(roda2.id))).statusCode).toBe(201);
  });

  it("cargos: Membro não cria sala nem convida; cargo sem 'enviar' não manda mensagem", async () => {
    const roda = await newRoda(bob);
    const invite = (await req(bob, "POST", `/api/rodas/${roda.id}/invites`, {})).json().invite;
    await req(carol, "POST", `/api/invites/${invite.code}/join`);

    expect((await req(carol, "POST", `/api/rodas/${roda.id}/channels`, { name: "minha", kind: "text" })).statusCode).toBe(403);
    expect((await req(carol, "POST", `/api/rodas/${roda.id}/invites`, {})).statusCode).toBe(403);
    expect((await req(carol, "POST", `/api/rodas/${roda.id}/roles`, { name: "x", color: "#ffffff", perms: [] })).statusCode).toBe(403);

    const quiet = (await req(bob, "POST", `/api/rodas/${roda.id}/roles`, { name: "Calado", color: "#888888", perms: ["ver"] })).json().role;
    expect((await req(bob, "PATCH", `/api/rodas/${roda.id}/members/${carol.id}`, { roleId: quiet.id })).statusCode).toBe(200);
    expect((await post(carol, textIn(roda.id))).statusCode).toBe(403);
    expect((await req(carol, "GET", `/api/channels/${textIn(roda.id)}/messages`)).statusCode).toBe(200);

    // ninguém vira dono por aqui
    const owner = roda.roles.find((r) => r.owner)!;
    expect((await req(bob, "PATCH", `/api/rodas/${roda.id}/members/${carol.id}`, { roleId: owner.id })).statusCode).toBe(400);
  });

  it("reordenar salas: grava a lista inteira; Membro não pode; lista desatualizada é recusada", async () => {
    const roda = await newRoda(bob);
    const order = () => t.ctx.store.listChannels(roda.id).map((c) => c.name);
    const ids = t.ctx.store.listChannels(roda.id).map((c) => c.id); // geral, clipes, Ranked, Casual
    const url = `/api/rodas/${roda.id}/channels/order`;

    const res = await req(bob, "PUT", url, { ids: [ids[1], ids[0], ids[3], ids[2]] });
    expect(res.statusCode).toBe(200);
    expect(order()).toEqual(["clipes", "geral", "Casual", "Ranked"]);

    expect((await req(bob, "PUT", url, { ids: ids.slice(1) })).statusCode).toBe(400);
    expect((await req(bob, "PUT", url, { ids: [ids[0], ids[0], ids[1], ids[2]] })).statusCode).toBe(400);
    expect(order()).toEqual(["clipes", "geral", "Casual", "Ranked"]);

    const invite = (await req(bob, "POST", `/api/rodas/${roda.id}/invites`, {})).json().invite;
    await req(carol, "POST", `/api/invites/${invite.code}/join`);
    expect((await req(carol, "PUT", url, { ids })).statusCode).toBe(403);
  });

  it("capa da roda: só o dono troca, quem está na roda vê, e o arquivo sai junto ao tirar a capa ou apagar a roda", async () => {
    const roda = await newRoda(bob);
    const invite = (await req(bob, "POST", `/api/rodas/${roda.id}/invites`, {})).json().invite;
    await req(carol, "POST", `/api/invites/${invite.code}/join`);
    const send = (user: TestUser) => {
      const { payload, headers } = multipart("capa.png", png(600, 200));
      return t.app.inject({ method: "POST", url: `/api/rodas/${roda.id}/banner`, headers: { ...headers, cookie: user.cookie }, payload });
    };
    const fileOf = (res: { json(): { roda: { bannerUrl: string } } }) => res.json().roda.bannerUrl.split("/").pop()!;

    expect((await send(carol)).statusCode).toBe(403);
    const first = await send(bob);
    expect(first.statusCode).toBe(200);
    const id = fileOf(first);
    expect(t.ctx.store.allAvatarIds().has(id)).toBe(true); // a limpeza de arquivos soltos não apaga
    const image = await req(carol, "GET", `/api/banners/${id}`);
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");

    const moved = await req(bob, "PATCH", `/api/rodas/${roda.id}`, { bannerX: 20, bannerY: 80, bannerZoom: 1.5 });
    expect(moved.json().roda).toMatchObject({ bannerX: 20, bannerY: 80, bannerZoom: 1.5 });

    expect((await req(carol, "DELETE", `/api/rodas/${roda.id}/banner`)).statusCode).toBe(403);
    expect((await req(bob, "DELETE", `/api/rodas/${roda.id}/banner`)).json().roda.bannerUrl).toBeNull();
    expect(existsSync(t.ctx.avatars.pathFor(id))).toBe(false);

    const second = fileOf(await send(bob));
    expect((await req(bob, "DELETE", `/api/rodas/${roda.id}`)).statusCode).toBe(204);
    expect(existsSync(t.ctx.avatars.pathFor(second))).toBe(false);
  });

  it("expulsar tira o acesso; o dono não sai nem é expulso", async () => {
    const roda = await newRoda(bob);
    const invite = (await req(bob, "POST", `/api/rodas/${roda.id}/invites`, {})).json().invite;
    await req(carol, "POST", `/api/invites/${invite.code}/join`);
    expect((await req(carol, "DELETE", `/api/rodas/${roda.id}/members/${bob.id}`)).statusCode).toBe(403);
    expect((await req(bob, "DELETE", `/api/rodas/${roda.id}/members/me`)).statusCode).toBe(400);
    expect((await req(bob, "DELETE", `/api/rodas/${roda.id}/members/${carol.id}`)).statusCode).toBe(204);
    expect((await post(carol, textIn(roda.id))).statusCode).toBe(404);
  });

  it("roda aberta: qualquer um entra; privada não", async () => {
    const aberta = await newRoda(bob, { privacy: "aberta" });
    const privada = await newRoda(bob, { name: "Privada" });
    expect(t.ctx.store.openRodasFor(carol.id).map((r) => r.id)).toEqual([aberta.id]);
    expect((await req(carol, "POST", `/api/rodas/${privada.id}/join`)).statusCode).toBe(404);
    expect((await req(carol, "POST", `/api/rodas/${aberta.id}/join`)).statusCode).toBe(204);
    expect((await post(carol, textIn(aberta.id))).statusCode).toBe(201);
  });

  it("apagar a roda leva as salas e as mensagens junto (só o dono)", async () => {
    const roda = await newRoda(bob);
    const sala = textIn(roda.id);
    await post(bob, sala);
    expect((await req(carol, "DELETE", `/api/rodas/${roda.id}`)).statusCode).toBe(404);
    expect((await req(bob, "DELETE", `/api/rodas/${roda.id}`)).statusCode).toBe(204);
    expect(t.ctx.store.channelById(sala)).toBeNull();
    expect(t.ctx.store.rodaById(roda.id)).toBeNull();
  });
});

describe("migração para rodas", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("o grupo que existia vira a roda Resenha: admin mais antigo dono, outros admins moderação", () => {
    dir = mkdtempSync(path.join(tmpdir(), "resenha-rodas-"));
    const file = path.join(dir, "resenha.db");
    const old = new DatabaseSync(file);
    for (const m of MIGRATIONS.slice(0, 7)) old.exec(m);
    old.exec("PRAGMA user_version = 7");
    const addUser = old.prepare(
      "INSERT INTO users (id, username, display_name, password_hash, role, avatar_color, created_at) VALUES (?, ?, ?, '!', ?, '#e8590c', ?)",
    );
    addUser.run("u-diego", "diego", "Diego", "admin", 1);
    addUser.run("u-ana", "ana", "Ana", "admin", 2);
    addUser.run("u-rui", "rui", "Rui", "member", 3);
    old.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES ('c1', 'geral', 'text', 0, 1)").run();
    old.close();

    const db = openDatabase(file);
    const role = (u: string) =>
      (db.prepare("SELECT r.name FROM roda_members m JOIN roda_roles r ON r.id = m.role_id WHERE m.user_id = ?").get(u) as { name: string }).name;
    expect(role("u-diego")).toBe("Dono");
    expect(role("u-ana")).toBe("Moderação");
    expect(role("u-rui")).toBe("Membro");
    expect((db.prepare("SELECT roda_id FROM channels WHERE id = 'c1'").get() as { roda_id: string }).roda_id).toBe("resenha");
    db.close();
  });
});
