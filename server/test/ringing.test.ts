import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@resenha/shared";
import type { Hub } from "../src/realtime/hub.ts";
import { CallRinger, RING_MS } from "../src/voice/ringing.ts";
import { createTestApp, listen, registerUser, TestSocket, voiceChannelId, type TestApp, type TestUser } from "./helpers.ts";

let t: TestApp;
let port: number;
let ana: TestUser;
let bia: TestUser;
beforeEach(async () => {
  t = await createTestApp();
  await registerUser(t, "admin", "chefe");
  ana = await registerUser(t, "member", "ana");
  bia = await registerUser(t, "member", "bia");
  port = await listen(t);
});
afterEach(async () => t.close());

const connect = async (u: TestUser) => {
  const s = await TestSocket.connect(port, u.cookie);
  await s.waitFor("hello");
  return s;
};

describe("chamada no privado toca como no Discord", () => {
  it("quem liga faz tocar; recusar avisa quem ligou e para o toque", async () => {
    const { id } = t.ctx.store.createConversation("dm", "", [ana.id, bia.id]);
    const a = await connect(ana);
    const b = await connect(bia);
    a.send({ type: "voice.join", channelId: id });
    expect((await b.waitFor("call.ring", (e) => !!e.ring)).ring).toEqual({ callerId: ana.id, pending: [bia.id] });

    // outro aparelho da bia que abre agora também toca
    const b2 = await TestSocket.connect(port, bia.cookie);
    expect((await b2.waitFor("hello")).rings[id]).toEqual({ callerId: ana.id, pending: [bia.id] });

    b.send({ type: "call.decline", channelId: id });
    expect(await a.waitFor("call.declined")).toMatchObject({ channelId: id, userId: bia.id, reason: "recusou" });
    await b2.waitFor("call.ring", (e) => e.ring === null);
    expect(t.ctx.ringer.snapshot()).toEqual({});
    [a, b, b2].forEach((s) => s.close());
  });

  it("entrar na chamada é atender; quem ligou desistir também para o toque", async () => {
    const { id } = t.ctx.store.createConversation("dm", "", [ana.id, bia.id]);
    const a = await connect(ana);
    const b = await connect(bia);
    a.send({ type: "voice.join", channelId: id });
    await b.waitFor("call.ring", (e) => !!e.ring);
    b.send({ type: "voice.join", channelId: id });
    await a.waitFor("call.ring", (e) => e.ring === null);

    a.clear();
    b.send({ type: "voice.leave" });
    a.send({ type: "voice.leave" });
    await a.waitFor("voice.channel", (e) => e.members.length === 0);
    b.clear();
    a.send({ type: "voice.join", channelId: id }); // liga de novo e desiste
    await b.waitFor("call.ring", (e) => !!e.ring);
    b.clear();
    a.send({ type: "voice.leave" });
    await b.waitFor("call.ring", (e) => e.ring === null);
    a.close();
    b.close();
  });

  it("no grupo toca para todos; quem recusa sai da lista e os outros continuam tocando", async () => {
    const cris = await registerUser(t, "member", "cris");
    const { id } = t.ctx.store.createConversation("group", "Turma", [ana.id, bia.id, cris.id]);
    const a = await connect(ana);
    const b = await connect(bia);
    a.send({ type: "voice.join", channelId: id });
    await b.waitFor("call.ring", (e) => e.ring?.pending.length === 2);
    b.send({ type: "call.decline", channelId: id });
    expect((await a.waitFor("call.ring", (e) => e.ring?.pending.length === 1)).ring?.pending).toEqual([cris.id]);
    a.close();
    b.close();
  });

  it("sala de voz da roda não toca", async () => {
    const a = await connect(ana);
    const b = await connect(bia);
    a.send({ type: "voice.join", channelId: voiceChannelId(t) });
    await b.waitFor("voice.channel", (e) => e.members.length === 1);
    expect(b.events.some((e) => e.type === "call.ring")).toBe(false);
    a.close();
    b.close();
  });
});

describe("tempo do toque", () => {
  it("sem resposta em 30 s vira 'não atendeu' e para de tocar", () => {
    vi.useFakeTimers();
    try {
      const sent: ServerEvent[] = [];
      const ringer = new CallRinger({ publish: (_: string[] | null, e: ServerEvent) => sent.push(e) } as unknown as Hub);
      ringer.audienceOf = () => ["ana", "bia", "cris"];
      ringer.start("c1", "ana");
      ringer.answered("c1", "cris");
      vi.advanceTimersByTime(RING_MS);
      expect(sent.filter((e) => e.type === "call.declined")).toEqual([
        { type: "call.declined", channelId: "c1", userId: "bia", reason: "nao-atendeu" },
      ]);
      expect(sent.at(-1)).toEqual({ type: "call.ring", channelId: "c1", ring: null });
      expect(ringer.snapshot()).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
