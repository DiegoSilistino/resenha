/**
 * Manutenção pelo terminal (rode com o servidor parado ou rodando; o SQLite aguenta).
 *
 *   npm run cli -- invite [--admin] [--uses N] [--hours H] [--roda "Nome da roda"]
 *   npm run cli -- reset-password <usuario>
 *   npm run cli -- users
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { hashPassword } from "./auth/password.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { newInviteCode } from "./routes/admin.ts";
import { Store } from "./store.ts";

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      admin: { type: "boolean", default: false },
      uses: { type: "string", default: "1" },
      hours: { type: "string", default: "72" },
      roda: { type: "string" },
    },
  });
  const [command, arg] = positionals;
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(openDatabase(config.dbPath));

  switch (command) {
    case "invite": {
      const uses = Number(values.uses);
      const hours = Number(values.hours);
      if (!Number.isInteger(uses) || uses < 1) throw new Error("--uses precisa ser um inteiro >= 1");
      if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours precisa ser > 0");
      // --roda "Nome" ou id: em qual roda a pessoa entra (sem: a roda principal)
      const roda = values.roda ? store.rodaByNameOrId(values.roda) : null;
      if (values.roda && !roda) throw new Error(`Roda "${values.roda}" não existe`);
      const invite = store.createInvite({
        code: newInviteCode(),
        role: values.admin ? "admin" : "member",
        maxUses: uses,
        expiresAt: Date.now() + hours * 3_600_000,
        createdBy: null,
        rodaId: roda?.id ?? null,
      });
      const where = invite.rodaId ? store.rodaById(invite.rodaId)?.name : null;
      console.log(
        `Convite (${invite.role}, ${uses} uso(s), ${hours} h${where ? `, roda ${where}` : ""}):\n${config.publicUrl}/convite/${invite.code}`,
      );
      break;
    }
    case "reset-password": {
      if (!arg) throw new Error("Informe o usuário: npm run cli -- reset-password <usuario>");
      const user = store.userByUsername(arg.toLowerCase());
      if (!user || user.removed) throw new Error(`Usuário "${arg}" não existe`);
      const temp = randomBytes(9).toString("base64url");
      store.setPasswordHash(user.id, await hashPassword(temp));
      store.deleteUserSessions(user.id);
      console.log(`Senha temporária de ${user.username}: ${temp}\nPeça para trocar em Configurações.`);
      break;
    }
    case "users": {
      for (const u of store.listUsers().filter((x) => !x.removed)) {
        console.log(`${u.username.padEnd(24)} ${u.role.padEnd(7)} ${u.disabled ? "desativado" : "ativo"}  ${u.displayName}`);
      }
      break;
    }
    default:
      console.log("Comandos: invite [--admin] [--uses N] [--hours H] | reset-password <usuario> | users");
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
