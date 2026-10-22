import { mkdirSync } from "node:fs";
import { buildApp } from "./app.ts";
import { bootstrap, startMaintenance } from "./bootstrap.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";

async function main() {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(config.dbPath);
  const { app, ctx } = await buildApp({ config, db });

  const { adminInviteUrl } = bootstrap(ctx);
  const stopMaintenance = startMaintenance(ctx, (msg) => app.log.info(msg));

  await app.listen({ host: config.host, port: config.port });

  if (adminInviteUrl) {
    const line = "=".repeat(72);
    console.log(
      `\n${line}\n  Primeira execução! Crie a conta de ADMINISTRADOR por este link:\n\n  ${adminInviteUrl}\n\n  (Ele vale uma única vez. Perdeu? Rode: npm run cli -- invite --admin)\n${line}\n`,
    );
  }

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} recebido, encerrando...`);
    stopMaintenance();
    ctx.hub.closeAll(1012, "servidor reiniciando");
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
