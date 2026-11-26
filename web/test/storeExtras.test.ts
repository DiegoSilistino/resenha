import { beforeEach, describe, expect, it } from "vitest";
import type { SoundboardSound } from "@resenha/shared";
import { useApp } from "../src/state/app.ts";

const sound = (id: string, name = id): SoundboardSound => ({
  id,
  name,
  emoji: "🔊",
  uploaderId: "u1",
  personal: false,
  url: `/api/sounds/${id}`,
  createdAt: 1,
});

describe("estado: mesa de sons e erros", () => {
  beforeEach(() => useApp.setState({ sounds: [], latestErrorId: 0 }));

  it("som novo entra no fim, editado troca no lugar, apagado sai", () => {
    const { applyEvent } = useApp.getState();
    applyEvent({ type: "sound.upsert", sound: sound("a") });
    applyEvent({ type: "sound.upsert", sound: sound("b") });
    applyEvent({ type: "sound.upsert", sound: sound("a", "Risada") });
    expect(useApp.getState().sounds.map((s) => s.name)).toEqual(["b", "Risada"]);
    applyEvent({ type: "sound.remove", soundId: "b" });
    expect(useApp.getState().sounds.map((s) => s.id)).toEqual(["a"]);
  });

  it("erro novo avança o último erro (nunca volta)", () => {
    const entry = (id: number) => ({
      id,
      userId: "u",
      kind: "voz" as const,
      message: "x",
      detail: "",
      userAgent: "",
      context: {},
      createdAt: 0,
      doneAt: null,
    });
    useApp.getState().applyEvent({ type: "admin.error", entry: entry(7) });
    useApp.getState().applyEvent({ type: "admin.error", entry: entry(3) });
    expect(useApp.getState().latestErrorId).toBe(7);
  });
});
