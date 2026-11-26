import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, listen, registerUser, TestSocket, type TestApp } from "./helpers.ts";

let t: TestApp | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await t?.close();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

/** Site compilado de mentira: só o index.html, que é o que muda a cada deploy. */
function dist(html: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "resenha-dist-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "index.html"), html);
  return dir;
}

async function helloBuild(webDist?: string): Promise<string | undefined> {
  t = await createTestApp(webDist ? { webDist } : {});
  const ana = await registerUser(t, "member", "ana");
  const socket = await TestSocket.connect(await listen(t), ana.cookie);
  const { build } = await socket.waitFor("hello");
  socket.close();
  await t.close();
  t = undefined;
  return build;
}

describe("versão do site no hello (aviso de atualização)", () => {
  it("cada build do site tem outra versão; sem site compilado, nenhuma", async () => {
    const first = await helloBuild(dist('<script src="/assets/index-aaa.js"></script>'));
    const second = await helloBuild(dist('<script src="/assets/index-bbb.js"></script>'));
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(second).toMatch(/^[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    expect(await helloBuild()).toBeUndefined();
  });
});

describe("prévia do link", () => {
  it("o index.html sai com a imagem da prévia no endereço completo do site", async () => {
    t = await createTestApp({ webDist: dist("<html><head><title>Resenha</title></head><body></body></html>") });
    const res = await t.app.inject({ method: "GET", url: "/convite/abc" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toContain('<meta property="og:image" content="http://localhost:5173/og.jpg" />');
  });
});
