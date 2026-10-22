import type { AppContext } from "./app.ts";
import { inviteUrl, newInviteCode } from "./routes/admin.ts";

const DEFAULT_CHANNELS = [
  { name: "geral", kind: "text" },
  { name: "links-e-memes", kind: "text" },
  { name: "Resenha", kind: "voice" },
  { name: "Jogatina", kind: "voice" },
] as const;

/**
 * Primeira execução: cria canais padrão e um convite de administrador.
 * O link aparece no log; quem usar primeiro vira admin. Reinícios reaproveitam o mesmo convite.
 */
export function bootstrap(ctx: AppContext): { adminInviteUrl: string | null } {
  const { store } = ctx;
  if (store.listChannels().length === 0) {
    for (const c of DEFAULT_CHANNELS) store.createChannel(c.name, c.kind);
  }
  if (store.countUsers() > 0) return { adminInviteUrl: null };

  const invite =
    store.pendingBootstrapInvite() ??
    store.createInvite({
      code: newInviteCode(),
      role: "admin",
      maxUses: 1,
      expiresAt: null,
      createdBy: null,
    });
  return { adminInviteUrl: inviteUrl(ctx, invite.code) };
}

const HOUR = 60 * 60 * 1000;

/** Limpezas periódicas. Devolve uma função que cancela os timers. */
export function startMaintenance(ctx: AppContext, log: (msg: string) => void): () => void {
  const { store, uploads, hub } = ctx;

  const cleanup = async () => {
    try {
      const sessions = store.deleteExpiredSessions();
      const orphans = store.deleteOrphanAttachments(24 * HOUR);
      await uploads.remove(orphans);
      const stray = await uploads.removeUnknown(store.allAttachmentIds(), 10 * 60 * 1000);
      if (sessions || orphans.length || stray) {
        log(`limpeza: ${sessions} sessões expiradas, ${orphans.length + stray} arquivos órfãos`);
      }
    } catch (err) {
      log(`falha na limpeza: ${(err as Error).message}`);
    }
  };

  const heartbeat = setInterval(() => hub.sweep(), 30_000);
  const hourly = setInterval(cleanup, HOUR);
  void cleanup();
  return () => {
    clearInterval(heartbeat);
    clearInterval(hourly);
  };
}
