import { afterEach, describe, expect, it } from "vitest";
import { createGiphy, isGiphyMediaUrl, toGifResults } from "../src/gifs/giphy.ts";
import { createTestApp, listen, registerUser, TestSocket, type TestApp } from "./helpers.ts";

const gif = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `GIF ${id}`,
  alt_text: "",
  images: {
    original: { width: "480", height: "270", mp4: `https://media2.giphy.com/media/${id}/giphy.mp4?cid=x`, url: `https://media2.giphy.com/media/${id}/giphy.gif` },
    fixed_width: { width: "200", height: "113", webp: `https://media2.giphy.com/media/${id}/200w.webp`, mp4: `https://media2.giphy.com/media/${id}/200w.mp4` },
    fixed_width_downsampled: { width: "200", height: "113", webp: `https://media2.giphy.com/media/${id}/200w_d.webp` },
  },
  ...extra,
});

/** GIPHY falso: registra as chamadas e responde com o que o teste mandar. */
function fakeGiphy(respond: (url: URL) => { status?: number; body?: unknown } = () => ({ body: { data: [gif("a1")] } })) {
  const calls: URL[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const r = respond(url);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("conversão da resposta do GIPHY", () => {
  it("pega MP4 do original e prévia leve, com dimensões numéricas", () => {
    expect(toGifResults({ data: [gif("a1")] })).toEqual([
      {
        id: "a1",
        title: "GIF a1",
        previewUrl: "https://media2.giphy.com/media/a1/200w_d.webp",
        mp4Url: "https://media2.giphy.com/media/a1/giphy.mp4?cid=x",
        width: 480,
        height: 270,
      },
    ]);
  });

  it("descarta itens incompletos ou com mídia fora do GIPHY", () => {
    const evil = gif("x", { images: { original: { width: "1", height: "1", mp4: "https://evil.example/x.mp4" }, fixed_width: { webp: "https://evil.example/x.webp" } } });
    expect(toGifResults({ data: [{ id: "sem-imagens" }, evil, gif("ok")] }).map((g) => g.id)).toEqual(["ok"]);
    expect(toGifResults(null)).toEqual([]);
  });

  it("só aceita servidores de mídia do GIPHY, por https", () => {
    expect(isGiphyMediaUrl("https://media4.giphy.com/media/a/giphy.mp4")).toBe(true);
    expect(isGiphyMediaUrl("https://i.giphy.com/a.mp4")).toBe(true);
    expect(isGiphyMediaUrl("http://media.giphy.com/media/a/giphy.mp4")).toBe(false);
    expect(isGiphyMediaUrl("https://giphy.com.evil.example/a.mp4")).toBe(false);
    expect(isGiphyMediaUrl("https://api.giphy.com/v1")).toBe(false);
  });
});

describe("cache e erros", () => {
  it("a mesma busca dentro de 1 hora não gasta outra chamada", async () => {
    let now = 0;
    const { calls, fetchFn } = fakeGiphy();
    const g = createGiphy({ apiKey: "k", baseUrl: "https://api.giphy.com", fetch: fetchFn, now: () => now });
    await g.search("Gato", 0);
    await g.search("gato", 0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get("q")).toBe("gato");
    expect(calls[0]!.searchParams.get("rating")).toBe("pg-13");
    expect(calls[0]!.searchParams.get("api_key")).toBe("k");
    now += 61 * 60 * 1000;
    await g.search("gato", 0);
    expect(calls).toHaveLength(2);
  });

  it("limite do GIPHY vira mensagem clara", async () => {
    const { fetchFn } = fakeGiphy(() => ({ status: 429 }));
    const g = createGiphy({ apiKey: "k", baseUrl: "https://api.giphy.com", fetch: fetchFn });
    await expect(g.trending(0)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/100 por hora/) });
  });
});

describe("rota de GIFs", () => {
  let t: TestApp;
  afterEach(async () => t.close());

  it("sem chave configurada: recurso desligado e avisado no hello", async () => {
    t = await createTestApp();
    const u = await registerUser(t);
    expect((await t.app.inject({ method: "GET", url: "/api/gifs", headers: { cookie: u.cookie } })).statusCode).toBe(404);
    const socket = await TestSocket.connect(await listen(t), u.cookie);
    expect((await socket.waitFor("hello")).features).toEqual({ gifs: false });
    socket.close();
  });

  it("com chave: em alta sem busca, resultados com busca, e exige login", async () => {
    const { calls, fetchFn } = fakeGiphy((url) => ({ body: { data: [gif(url.pathname.includes("search") ? "busca" : "alta")] } }));
    t = await createTestApp({ gifFetch: fetchFn });
    const u = await registerUser(t);
    const trending = await t.app.inject({ method: "GET", url: "/api/gifs", headers: { cookie: u.cookie } });
    expect(trending.json().gifs[0].id).toBe("alta");
    const search = await t.app.inject({ method: "GET", url: "/api/gifs?q=risada&offset=24", headers: { cookie: u.cookie } });
    expect(search.json().gifs[0].id).toBe("busca");
    expect(calls.at(-1)!.searchParams.get("offset")).toBe("24");
    expect((await t.app.inject({ method: "GET", url: "/api/gifs" })).statusCode).toBe(401);
    const socket = await TestSocket.connect(await listen(t), u.cookie);
    expect((await socket.waitFor("hello")).features).toEqual({ gifs: true });
    socket.close();
  });
});
