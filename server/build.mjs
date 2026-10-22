// Empacota o servidor num único arquivo, incluindo o pacote @resenha/shared.
// As dependências reais continuam em node_modules (não são embutidas).
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith("@resenha/"));

for (const entry of ["index", "cli"]) {
  await build({
    entryPoints: [`src/${entry}.ts`],
    outfile: `dist/${entry}.js`,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: true,
    external: [...external, "node:*"],
    logLevel: "info",
  });
}
