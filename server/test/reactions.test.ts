import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@resenha/shared";
import { createTestApp, listen, registerUser, textChannelId, TestSocket, type TestApp, type TestUser } from "./helpers.ts";

let t: TestApp;
let alice: TestUser;
let bob: TestUser;
let messageId: number;

beforeEach(async () => {
  t = await createTestApp();
  alice = await registerUser(t, "member", "alice");
  bob = await registerUser(t, "member", "bob");
  const res = await t.app.inject({
    method: "POST",
    url: `/api/channels/${textChannelId(t)}/messages`,
    headers: { cookie: alice.cookie },
    payload: { content: "bora jogar?" },
  });
  messageId = res.json().message.id;
});
afterEach(async () => {
  await t.close();
});

const react = (user: TestUser, emoji: string, method: "PUT" | "DELETE" = "PUT", id = messageId) =>
  t.app.inject({
    method,
    url: `/api/messages/${id}/reactions/${encodeURIComponent(emoji)}`,
    headers: { cookie: user.cookie },
  });

const reactionsOf = () => t.ctx.store.messageById(messageId)!.reactions;

describe("reações", () => {
  it("agrupa por emoji, na ordem de chegada, e avisa todo mundo", async () => {
    const port = await listen(t);
    const socket = await TestSocket.connect(port, alice.cookie);
    await socket.waitFor("hello");

    expect((await react(bob, "👍")).statusCode).toBe(204);
    const event = await socket.waitFor("message.reactions");
    expect(event).toMatchObject({ messageId, reactions: [{ emoji: "👍", userIds: [bob.id] }] });

    await react(alice, "😂");
    await react(alice, "👍");
    expect(reactionsOf()).toEqual([
      { emoji: "👍", userIds: [bob.id, alice.id] },
      { emoji: "😂", userIds: [alice.id] },
    ]);
    socket.close();
  });

  it("reagir duas vezes não duplica; tirar remove só a sua", async () => {
    await react(bob, "🔥");
    await react(bob, "🔥");
    await react(alice, "🔥");
    expect(reactionsOf()).toEqual([{ emoji: "🔥", userIds: [bob.id, alice.id] }]);
    expect((await react(bob, "🔥", "DELETE")).statusCode).toBe(204);
    expect(reactionsOf()).toEqual([{ emoji: "🔥", userIds: [alice.id] }]);
    await react(alice, "🔥", "DELETE");
    expect(reactionsOf()).toEqual([]);
  });

  it("emojis compostos funcionam; texto e emoji duplo não", async () => {
    expect((await react(bob, "👍🏽")).statusCode).toBe(204);
    expect((await react(bob, "🇧🇷")).statusCode).toBe(204);
    expect((await react(bob, "kkk")).statusCode).toBe(400);
    expect((await react(bob, "👍👍")).statusCode).toBe(400);
    expect(reactionsOf().map((r) => r.emoji)).toEqual(["👍🏽", "🇧🇷"]);
  });

  it(`limite de ${LIMITS.reactionsPerMessage} emojis diferentes, mas dá para somar nos que já existem`, async () => {
    const pool = [..."😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪"];
    for (const e of pool.slice(0, LIMITS.reactionsPerMessage)) expect((await react(bob, e)).statusCode).toBe(204);
    expect((await react(bob, pool[LIMITS.reactionsPerMessage]!)).statusCode).toBe(400);
    expect((await react(alice, pool[0]!)).statusCode).toBe(204);
  });

  it("aparece na listagem e some junto com a mensagem", async () => {
    await react(bob, "❤️");
    const list = await t.app.inject({
      method: "GET",
      url: `/api/channels/${textChannelId(t)}/messages`,
      headers: { cookie: bob.cookie },
    });
    expect(list.json().messages[0].reactions).toEqual([{ emoji: "❤️", userIds: [bob.id] }]);

    await t.app.inject({ method: "DELETE", url: `/api/messages/${messageId}`, headers: { cookie: alice.cookie } });
    const { n } = t.ctx.store.db.prepare("SELECT COUNT(*) AS n FROM reactions").get() as { n: number };
    expect(n).toBe(0);
    expect((await react(bob, "❤️")).statusCode).toBe(404);
  });

  it("exige login", async () => {
    const res = await t.app.inject({ method: "PUT", url: `/api/messages/${messageId}/reactions/${encodeURIComponent("👍")}` });
    expect(res.statusCode).toBe(401);
  });
});
