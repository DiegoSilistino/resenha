import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, listen, registerUser, TestSocket, type TestApp, type TestUser } from "./helpers.ts";

let t: TestApp;
let admin: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeEach(async () => {
  t = await createTestApp();
  admin = await registerUser(t, "admin", "admin");
  bob = await registerUser(t, "member", "bob");
  carol = await registerUser(t, "member", "carol");
});
afterEach(async () => {
  await t.close();
});

const req = (user: TestUser, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie: user.cookie }, ...(payload ? { payload } : {}) });

async function befriend(a: TestUser, b: TestUser) {
  await req(a, "POST", "/api/friends", { who: `@${b.username}` });
  await req(b, "POST", `/api/friends/${a.id}/accept`);
}

describe("nick#tag", () => {
  it("acha pelo nick único, pelo nick#tag e pelo @usuário; nick repetido pede o #tag", async () => {
    const tagOf = (u: TestUser) => t.ctx.store.userById(u.id)!.tag;
    expect(tagOf(bob)).toMatch(/^\d{4}$/);
    expect((await req(admin, "POST", "/api/friends", { who: "BOB" })).statusCode).toBe(200);

    t.ctx.store.updateUserProfile(bob.id, { displayName: "Zé" });
    t.ctx.store.updateUserProfile(carol.id, { displayName: "zé" });
    const dave = await registerUser(t, "member", "dave");
    expect((await req(dave, "POST", "/api/friends", { who: "Zé" })).statusCode).toBe(400);
    expect((await req(dave, "POST", "/api/friends", { who: `Zé#${tagOf(carol)}` })).json().friend.userId).toBe(carol.id);
    expect((await req(dave, "POST", "/api/friends", { who: "@bob" })).json().friend.userId).toBe(bob.id);
    expect((await req(dave, "POST", "/api/friends", { who: "ninguém#1234" })).statusCode).toBe(404);
  });
});

describe("grupo depois de criado", () => {
  it("renomeia e chama mais amigos; quem não é amigo não entra", async () => {
    await befriend(admin, bob);
    const group = (await req(admin, "POST", "/api/conversations", { userIds: [bob.id], name: "Dupla" })).json().conversation;
    expect((await req(bob, "PATCH", `/api/conversations/${group.id}`, { name: "Trio" })).json().conversation.name).toBe("Trio");
    expect((await req(admin, "POST", `/api/conversations/${group.id}/members`, { userIds: [carol.id] })).statusCode).toBe(400);
    await befriend(admin, carol);
    const res = await req(admin, "POST", `/api/conversations/${group.id}/members`, { userIds: [carol.id] });
    expect(res.json().conversation.memberIds).toContain(carol.id);
    expect((await req(carol, "GET", `/api/channels/${group.id}/messages`)).statusCode).toBe(200);
  });
});

describe("posse da roda", () => {
  it("o dono passa a posse e fica com o cargo de quem recebeu", async () => {
    const roda = (await req(bob, "POST", "/api/rodas", { name: "Bob e cia" })).json().roda;
    const invite = (await req(bob, "POST", `/api/rodas/${roda.id}/invites`, {})).json().invite;
    await req(carol, "POST", `/api/invites/${invite.code}/join`);
    expect((await req(carol, "POST", `/api/rodas/${roda.id}/owner`, { userId: carol.id })).statusCode).toBe(403);
    expect((await req(bob, "POST", `/api/rodas/${roda.id}/owner`, { userId: carol.id })).statusCode).toBe(200);
    expect(t.ctx.store.memberRole(roda.id, carol.id)?.owner).toBe(true);
    expect(t.ctx.store.memberRole(roda.id, bob.id)?.name).toBe("Membro");
    // agora quem pode sair é o bob
    expect((await req(bob, "DELETE", `/api/rodas/${roda.id}/members/me`)).statusCode).toBe(204);
  });
});

describe("rodas abertas ao vivo", () => {
  it("criar aberta avisa todo mundo; fechar avisa que saiu da lista", async () => {
    const port = await listen(t);
    const carolSocket = await TestSocket.connect(port, carol.cookie);
    await carolSocket.waitFor("hello");
    const roda = (await req(bob, "POST", "/api/rodas", { name: "Aberta", privacy: "aberta" })).json().roda;
    expect((await carolSocket.waitFor("roda.open")).roda).toMatchObject({ id: roda.id, memberCount: 1 });
    await req(bob, "PATCH", `/api/rodas/${roda.id}`, { privacy: "privada" });
    expect((await carolSocket.waitFor("roda.closed")).rodaId).toBe(roda.id);
    carolSocket.close();
  });
});

describe("convite do admin", () => {
  it("escolhe a roda em que a pessoa entra", async () => {
    const roda = (await req(admin, "POST", "/api/rodas", { name: "Segunda" })).json().roda;
    const invite = (await req(admin, "POST", "/api/admin/invites", { rodaId: roda.id })).json().invite;
    expect(invite.rodaId).toBe(roda.id);
    expect((await req(admin, "POST", "/api/admin/invites", { rodaId: "nao-existe" })).statusCode).toBe(400);
  });
});
