import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@resenha/shared";
import { createTestApp, registerUser, textChannelId, voiceChannelId, type TestApp, type TestUser } from "./helpers.ts";

let t: TestApp;
let alice: TestUser;
let bob: TestUser;
let channel: string;

beforeEach(async () => {
  t = await createTestApp();
  alice = await registerUser(t, "member", "alice");
  bob = await registerUser(t, "member", "bob");
  channel = textChannelId(t);
});
afterEach(async () => {
  await t.close();
});

const post = (user: TestUser, content: string, attachmentIds: string[] = [], ch = channel) =>
  t.app.inject({
    method: "POST",
    url: `/api/channels/${ch}/messages`,
    headers: { cookie: user.cookie },
    payload: { content, attachmentIds },
  });

function multipart(filename: string, content: Buffer) {
  const boundary = "----resenhatest";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const upload = (user: TestUser, filename: string, content: Buffer) => {
  const { payload, headers } = multipart(filename, content);
  return t.app.inject({ method: "POST", url: "/api/uploads", headers: { ...headers, cookie: user.cookie }, payload });
};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe("mensagens", () => {
  it("envia e lista em ordem cronológica, com paginação", async () => {
    for (let i = 1; i <= 5; i++) expect((await post(alice, `msg ${i}`)).statusCode).toBe(201);

    const page1 = await t.app.inject({
      method: "GET",
      url: `/api/channels/${channel}/messages?limit=3`,
      headers: { cookie: bob.cookie },
    });
    const body1 = page1.json();
    expect(body1.messages.map((m: { content: string }) => m.content)).toEqual(["msg 3", "msg 4", "msg 5"]);
    expect(body1.hasMore).toBe(true);

    const page2 = await t.app.inject({
      method: "GET",
      url: `/api/channels/${channel}/messages?limit=3&before=${body1.messages[0].id}`,
      headers: { cookie: bob.cookie },
    });
    expect(page2.json().messages.map((m: { content: string }) => m.content)).toEqual(["msg 1", "msg 2"]);
  });

  it("recusa mensagem vazia ou longa demais", async () => {
    expect((await post(alice, "   ")).statusCode).toBe(400);
    expect((await post(alice, "x".repeat(LIMITS.messageMax + 1))).statusCode).toBe(400);
  });

  it("canal de voz também tem chat", async () => {
    const voice = voiceChannelId(t);
    expect((await post(alice, "link do jogo: https://exemplo.com", [], voice)).statusCode).toBe(201);
    const list = await t.app.inject({ method: "GET", url: `/api/channels/${voice}/messages`, headers: { cookie: bob.cookie } });
    expect(list.json().messages.map((m: { content: string }) => m.content)).toEqual(["link do jogo: https://exemplo.com"]);
  });

  it("exige login", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/channels/${channel}/messages` });
    expect(res.statusCode).toBe(401);
  });

  it("só o autor edita; autor ou admin apagam", async () => {
    const msg = (await post(alice, "original")).json().message;

    const bobEdit = await t.app.inject({
      method: "PATCH",
      url: `/api/messages/${msg.id}`,
      headers: { cookie: bob.cookie },
      payload: { content: "invadido" },
    });
    expect(bobEdit.statusCode).toBe(403);

    const aliceEdit = await t.app.inject({
      method: "PATCH",
      url: `/api/messages/${msg.id}`,
      headers: { cookie: alice.cookie },
      payload: { content: "editado" },
    });
    expect(aliceEdit.json().message.content).toBe("editado");
    expect(aliceEdit.json().message.editedAt).toBeTypeOf("number");

    expect(
      (await t.app.inject({ method: "DELETE", url: `/api/messages/${msg.id}`, headers: { cookie: bob.cookie } })).statusCode,
    ).toBe(403);

    const admin = await registerUser(t, "admin");
    expect(
      (await t.app.inject({ method: "DELETE", url: `/api/messages/${msg.id}`, headers: { cookie: admin.cookie } }))
        .statusCode,
    ).toBe(204);
  });

  it("id de mensagem inválido dá 404, não 500", async () => {
    const res = await t.app.inject({ method: "DELETE", url: "/api/messages/abc", headers: { cookie: alice.cookie } });
    expect(res.statusCode).toBe(404);
  });
});

describe("respostas", () => {
  const reply = (user: TestUser, content: string, replyTo: number, ch = channel) =>
    t.app.inject({
      method: "POST",
      url: `/api/channels/${ch}/messages`,
      headers: { cookie: user.cookie },
      payload: { content, replyTo },
    });

  it("guarda a citação com autor e começo do texto", async () => {
    const original = (await post(alice, "bora jogar hoje às 21h?")).json().message;
    const res = await reply(bob, "fechado!", original.id);
    expect(res.statusCode).toBe(201);
    expect(res.json().message.replyTo).toEqual({
      id: original.id,
      deleted: false,
      authorId: alice.id,
      content: "bora jogar hoje às 21h?",
      attachmentCount: 0,
    });
  });

  it("citação de texto longo vem cortada; de foto, conta o anexo", async () => {
    const long = (await post(alice, "a".repeat(1000))).json().message;
    expect((await reply(bob, "ok", long.id)).json().message.replyTo.content).toHaveLength(200);

    const up = multipart("f.png", PNG);
    const att = (await t.app.inject({ method: "POST", url: "/api/uploads", headers: { ...up.headers, cookie: alice.cookie }, payload: up.payload })).json().attachment;
    const photo = (await post(alice, "", [att.id])).json().message;
    expect((await reply(bob, "que foto!", photo.id)).json().message.replyTo).toMatchObject({ content: "", attachmentCount: 1 });
  });

  it("se a original for apagada, a resposta mostra que ela sumiu", async () => {
    const original = (await post(alice, "vou apagar")).json().message;
    const answer = (await reply(bob, "respondi", original.id)).json().message;
    await t.app.inject({ method: "DELETE", url: `/api/messages/${original.id}`, headers: { cookie: alice.cookie } });
    const list = await t.app.inject({ method: "GET", url: `/api/channels/${channel}/messages`, headers: { cookie: bob.cookie } });
    const kept = list.json().messages.find((m: { id: number }) => m.id === answer.id);
    expect(kept.replyTo).toEqual({ id: original.id, deleted: true, authorId: null, content: "", attachmentCount: 0 });
  });

  it("não deixa responder mensagem de outro canal ou inexistente", async () => {
    const original = (await post(alice, "no geral")).json().message;
    expect((await reply(bob, "aqui", original.id, voiceChannelId(t))).statusCode).toBe(400);
    expect((await reply(bob, "fantasma", 999_999)).statusCode).toBe(400);
  });
});

describe("anexos", () => {
  it("imagem real é exibida inline com cabeçalhos seguros", async () => {
    const up = await upload(alice, "foto.png", PNG);
    expect(up.statusCode).toBe(201);
    const { attachment } = up.json();
    expect(attachment).toMatchObject({ filename: "foto.png", mime: "image/png", inline: true, size: PNG.length });

    const msg = await post(alice, "", [attachment.id]);
    expect(msg.statusCode).toBe(201);
    expect(msg.json().message.attachments).toHaveLength(1);

    const file = await t.app.inject({ method: "GET", url: attachment.url, headers: { cookie: bob.cookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(file.headers["content-disposition"])).toMatch(/^inline/);
    expect(String(file.headers["cache-control"])).toContain("immutable");
    expect(file.rawPayload.equals(PNG)).toBe(true);
  });

  it("HTML disfarçado vira download, nunca página (anti-XSS)", async () => {
    const up = await upload(alice, "foto.png", Buffer.from("<html><script>alert(1)</script></html>"));
    const { attachment } = up.json();
    expect(attachment).toMatchObject({ mime: "application/octet-stream", inline: false });
    const file = await t.app.inject({ method: "GET", url: attachment.url, headers: { cookie: bob.cookie } });
    expect(file.headers["content-type"]).toBe("application/octet-stream");
    expect(String(file.headers["content-disposition"])).toMatch(/^attachment/);
    expect(String(file.headers["content-security-policy"])).toContain("sandbox");
  });

  it("limpa nomes de arquivo perigosos", async () => {
    const up = await upload(alice, "../../etc/passwd", Buffer.from("x"));
    expect(up.json().attachment.filename).toBe("passwd");
  });

  it("não deixa usar o anexo de outra pessoa nem reutilizar", async () => {
    const { attachment } = (await upload(alice, "a.png", PNG)).json();
    expect((await post(bob, "roubando", [attachment.id])).statusCode).toBe(400);
    expect((await post(alice, "meu", [attachment.id])).statusCode).toBe(201);
    expect((await post(alice, "de novo", [attachment.id])).statusCode).toBe(400);
  });

  it("apagar a mensagem apaga o arquivo do disco", async () => {
    const { attachment } = (await upload(alice, "a.png", PNG)).json();
    const msg = (await post(alice, "com foto", [attachment.id])).json().message;
    const file = t.ctx.uploads.pathFor(attachment.id);
    expect(existsSync(file)).toBe(true);
    await t.app.inject({ method: "DELETE", url: `/api/messages/${msg.id}`, headers: { cookie: alice.cookie } });
    expect(existsSync(file)).toBe(false);
  });

  it("recusa arquivo acima do limite e não deixa lixo no disco", async () => {
    const big = Buffer.alloc(LIMITS.uploadMaxBytes + 1024, 7);
    const res = await upload(alice, "grande.bin", big);
    expect(res.statusCode).toBe(413);
    expect(t.ctx.store.allAttachmentIds().size).toBe(0);
    expect(await t.ctx.uploads.removeUnknown(new Set(), -1)).toBe(0);
  });
});
