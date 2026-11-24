import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, listen, registerUser, TestSocket, type TestApp, type TestUser } from "./helpers.ts";
import { multipart } from "./images.ts";

let t: TestApp;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeEach(async () => {
  t = await createTestApp();
  alice = await registerUser(t, "member", "alice");
  bob = await registerUser(t, "member", "bob");
  carol = await registerUser(t, "member", "carol");
});
afterEach(async () => {
  await t.close();
});

const req = (user: TestUser, method: "GET" | "POST" | "DELETE", url: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie: user.cookie }, ...(payload ? { payload } : {}) });

async function befriend(a: TestUser, b: TestUser) {
  expect((await req(a, "POST", "/api/friends", { who: `@${b.username}` })).statusCode).toBe(200);
  expect((await req(b, "POST", `/api/friends/${a.id}/accept`)).statusCode).toBe(200);
}

async function dm(a: TestUser, b: TestUser): Promise<string> {
  const res = await req(a, "POST", "/api/conversations", { userIds: [b.id] });
  expect([200, 201]).toContain(res.statusCode);
  return res.json().conversation.id;
}

describe("amizades", () => {
  it("pedido, aceite e cada um vê do seu lado; desfazer some para os dois", async () => {
    const port = await listen(t);
    const bobSocket = await TestSocket.connect(port, bob.cookie);
    await bobSocket.waitFor("hello");

    const sent = await req(alice, "POST", "/api/friends", { who: "BOB" });
    expect(sent.json().friend).toMatchObject({ userId: bob.id, status: "outgoing" });
    expect((await bobSocket.waitFor("friend.upsert")).friend).toMatchObject({ userId: alice.id, status: "incoming" });

    expect((await req(alice, "POST", "/api/friends", { who: "bob" })).statusCode).toBe(400); // já pedido
    await req(bob, "POST", `/api/friends/${alice.id}/accept`);
    expect(t.ctx.store.areFriends(alice.id, bob.id)).toBe(true);

    await req(bob, "DELETE", `/api/friends/${alice.id}`);
    expect(t.ctx.store.listFriends(alice.id)).toEqual([]);
    expect((await bobSocket.waitFor("friend.remove")).userId).toBe(alice.id);
    bobSocket.close();
  });

  it("pedido cruzado vira amizade; link de amizade manda o pedido sem digitar", async () => {
    await req(alice, "POST", "/api/friends", { who: "bob" });
    expect((await req(bob, "POST", "/api/friends", { who: "alice" })).json().friend.status).toBe("friend");

    const { code } = (await req(carol, "GET", "/api/friends/link")).json();
    expect((await req(alice, "POST", `/api/friends/link/${code}`)).json().friend.status).toBe("outgoing");
    expect((await req(alice, "POST", "/api/friends/link/naoexiste123")).statusCode).toBe(404);
    expect((await req(alice, "POST", "/api/friends", { who: "ninguem" })).statusCode).toBe(404);
  });
});

describe("conversas privadas", () => {
  it("só com amigos; a conversa a dois é uma só por par", async () => {
    expect((await req(alice, "POST", "/api/conversations", { userIds: [bob.id] })).statusCode).toBe(400);
    await befriend(alice, bob);
    const first = await dm(alice, bob);
    expect(await dm(bob, alice)).toBe(first);
  });

  it("quem não participa não vê mensagens, eventos, busca, anexos nem a chamada", async () => {
    await befriend(alice, bob);
    const id = await dm(alice, bob);
    const port = await listen(t);
    const bobSocket = await TestSocket.connect(port, bob.cookie);
    const carolSocket = await TestSocket.connect(port, carol.cookie);
    await bobSocket.waitFor("hello");
    const carolHello = await carolSocket.waitFor("hello");
    expect(carolHello.conversations).toEqual([]);
    expect(carolHello.channels.map((c) => c.id)).not.toContain(id);

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const { payload, headers } = multipart("foto.png", png);
    const upload = await t.app.inject({ method: "POST", url: "/api/uploads", headers: { ...headers, cookie: alice.cookie }, payload });
    const attachment = upload.json().attachment;
    const sent = await req(alice, "POST", `/api/channels/${id}/messages`, { content: "segredo combinado", attachmentIds: [attachment.id] });
    expect(sent.statusCode).toBe(201);
    const messageId = sent.json().message.id;

    expect((await bobSocket.waitFor("message.create")).message.content).toBe("segredo combinado");
    expect((await req(carol, "GET", `/api/channels/${id}/messages`)).statusCode).toBe(404);
    expect((await req(carol, "POST", `/api/channels/${id}/messages`, { content: "oi", attachmentIds: [] })).statusCode).toBe(404);
    expect((await req(carol, "DELETE", `/api/messages/${messageId}`)).statusCode).toBe(404);
    expect((await req(carol, "GET", sent.json().message.attachments[0].url)).statusCode).toBe(404);
    expect((await req(bob, "GET", sent.json().message.attachments[0].url)).statusCode).toBe(200);
    expect((await req(carol, "GET", "/api/search?q=segredo")).json().results).toEqual([]);
    expect((await req(bob, "GET", "/api/search?q=segredo")).json().results).toHaveLength(1);
    expect((await req(carol, "POST", "/api/voice/token", { channelId: id })).statusCode).toBe(404);
    expect((await req(bob, "POST", "/api/voice/token", { channelId: id })).statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 100));
    expect(carolSocket.events.some((e) => e.type === "message.create")).toBe(false);
    bobSocket.close();
    carolSocket.close();
  });

  it("visto: quem lê avisa os outros membros; não lidas chegam no hello", async () => {
    await befriend(alice, bob);
    const id = await dm(alice, bob);
    const m1 = (await req(alice, "POST", `/api/channels/${id}/messages`, { content: "um", attachmentIds: [] })).json().message.id;
    await req(alice, "POST", `/api/channels/${id}/messages`, { content: "dois", attachmentIds: [] });
    expect(t.ctx.store.conversationUnread(bob.id)).toEqual({ [id]: 2 });

    const port = await listen(t);
    const aliceSocket = await TestSocket.connect(port, alice.cookie);
    await aliceSocket.waitFor("hello");
    await req(bob, "POST", `/api/conversations/${id}/read`, { messageId: m1 });
    expect(await aliceSocket.waitFor("conversation.read")).toMatchObject({ conversationId: id, userId: bob.id, messageId: m1 });
    expect(t.ctx.store.conversationUnread(bob.id)).toEqual({ [id]: 1 });
    aliceSocket.close();
  });

  it("grupo: até 10 pessoas, todo mundo amigo de quem cria; o último a sair apaga", async () => {
    await befriend(alice, bob);
    await befriend(alice, carol);
    const res = await req(alice, "POST", "/api/conversations", { userIds: [bob.id, carol.id], name: "Trio" });
    expect(res.statusCode).toBe(201);
    const group = res.json().conversation;
    expect(group).toMatchObject({ type: "group", name: "Trio" });
    expect(group.memberIds).toHaveLength(3);

    for (const u of [alice, bob]) expect((await req(u, "DELETE", `/api/conversations/${group.id}/members/me`)).statusCode).toBe(204);
    expect(t.ctx.store.conversationById(group.id)!.memberIds).toEqual([carol.id]);
    await req(carol, "DELETE", `/api/conversations/${group.id}/members/me`);
    expect(t.ctx.store.conversationById(group.id)).toBeNull();
  });
});
