/**
 * Acesso a dados. Todo SQL do app mora aqui, com parâmetros posicionais (sem concatenação).
 */
import { randomUUID } from "node:crypto";
import type {
  Attachment,
  Channel,
  ChannelKind,
  Invite,
  Message,
  PublicUser,
  Role,
} from "@resenha/shared";
import { transaction, type Db } from "./db.ts";

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  avatar_color: string;
  created_at: number;
  disabled_at: number | null;
}

export interface UserRecord extends PublicUser {
  passwordHash: string;
  createdAt: number;
}

interface ChannelRow {
  id: string;
  name: string;
  kind: ChannelKind;
  position: number;
}

interface MessageRow {
  id: number;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: number;
  edited_at: number | null;
}

interface AttachmentRow {
  id: string;
  uploader_id: string;
  message_id: number | null;
  filename: string;
  mime: string;
  size: number;
  inline: number;
  created_at: number;
}

export interface AttachmentRecord extends Attachment {
  uploaderId: string;
  messageId: number | null;
  createdAt: number;
}

interface InviteRow {
  code: string;
  role: Role;
  max_uses: number;
  uses: number;
  expires_at: number | null;
  created_at: number;
  created_by: string | null;
  revoked_at: number | null;
}

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  avatarColor: r.avatar_color,
  role: r.role,
  disabled: r.disabled_at !== null,
  passwordHash: r.password_hash,
  createdAt: r.created_at,
});

export const toPublicUser = (u: UserRecord): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarColor: u.avatarColor,
  role: u.role,
  disabled: u.disabled,
});

const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  position: r.position,
});

export const attachmentUrl = (id: string, filename: string) =>
  `/api/files/${id}/${encodeURIComponent(filename)}`;

const toAttachment = (r: AttachmentRow): AttachmentRecord => ({
  id: r.id,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  inline: r.inline === 1,
  url: attachmentUrl(r.id, r.filename),
  uploaderId: r.uploader_id,
  messageId: r.message_id,
  createdAt: r.created_at,
});

const publicAttachment = (a: AttachmentRecord): Attachment => ({
  id: a.id,
  filename: a.filename,
  mime: a.mime,
  size: a.size,
  url: a.url,
  inline: a.inline,
});

const toInvite = (r: InviteRow): Invite => ({
  code: r.code,
  role: r.role,
  maxUses: r.max_uses,
  uses: r.uses,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  createdBy: r.created_by ?? "",
  revoked: r.revoked_at !== null,
});

export class Store {
  constructor(readonly db: Db) {}

  // ---------- usuários ----------

  countUsers(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  }

  userById(id: string): UserRecord | null {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return r ? toUser(r) : null;
  }

  userByUsername(username: string): UserRecord | null {
    const r = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;
    return r ? toUser(r) : null;
  }

  listUsers(): UserRecord[] {
    return (this.db.prepare("SELECT * FROM users ORDER BY display_name COLLATE NOCASE").all() as unknown as UserRow[]).map(toUser);
  }

  createUser(u: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: Role;
    avatarColor: string;
  }): UserRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, password_hash, role, avatar_color, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, u.username, u.displayName, u.passwordHash, u.role, u.avatarColor, Date.now());
    return this.userById(id)!;
  }

  updateUserProfile(id: string, p: { displayName?: string; avatarColor?: string }): UserRecord {
    this.db
      .prepare(
        `UPDATE users SET display_name = COALESCE(?, display_name), avatar_color = COALESCE(?, avatar_color)
         WHERE id = ?`,
      )
      .run(p.displayName ?? null, p.avatarColor ?? null, id);
    return this.userById(id)!;
  }

  setPasswordHash(id: string, hash: string): void {
    this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  }

  setUserDisabled(id: string, disabled: boolean): UserRecord | null {
    this.db
      .prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
      .run(disabled ? Date.now() : null, id);
    return this.userById(id);
  }

  setUserRole(id: string, role: Role): UserRecord | null {
    this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    return this.userById(id);
  }

  countActiveAdmins(): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL")
        .get() as { n: number }
    ).n;
  }

  // ---------- sessões ----------

  insertSession(s: { tokenHash: string; userId: string; expiresAt: number; userAgent: string | null }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(s.tokenHash, s.userId, now, s.expiresAt, now, s.userAgent);
  }

  sessionByHash(tokenHash: string): { userId: string; expiresAt: number; lastSeenAt: number } | null {
    const r = this.db
      .prepare("SELECT user_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?")
      .get(tokenHash) as { user_id: string; expires_at: number; last_seen_at: number } | undefined;
    return r ? { userId: r.user_id, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at } : null;
  }

  touchSession(tokenHash: string, expiresAt: number): void {
    this.db
      .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
      .run(Date.now(), expiresAt, tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  /** Remove as sessões do usuário (menos `keepHash`) e devolve os hashes removidos. */
  deleteUserSessions(userId: string, keepHash: string | null = null): string[] {
    const rows = this.db
      .prepare("SELECT token_hash FROM sessions WHERE user_id = ? AND token_hash IS NOT ?")
      .all(userId, keepHash) as { token_hash: string }[];
    this.db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?")
      .run(userId, keepHash);
    return rows.map((r) => r.token_hash);
  }

  deleteExpiredSessions(): number {
    return Number(this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now()).changes);
  }

  // ---------- convites ----------

  createInvite(i: {
    code: string;
    role: Role;
    maxUses: number;
    expiresAt: number | null;
    createdBy: string | null;
  }): Invite {
    this.db
      .prepare(
        `INSERT INTO invites (code, role, max_uses, expires_at, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(i.code, i.role, i.maxUses, i.expiresAt, Date.now(), i.createdBy);
    return this.inviteByCode(i.code)!;
  }

  inviteByCode(code: string): Invite | null {
    const r = this.db.prepare("SELECT * FROM invites WHERE code = ?").get(code) as InviteRow | undefined;
    return r ? toInvite(r) : null;
  }

  listInvites(): Invite[] {
    return (this.db.prepare("SELECT * FROM invites ORDER BY created_at DESC").all() as unknown as InviteRow[]).map(
      toInvite,
    );
  }

  /** Convite de admin gerado na primeira execução e ainda não usado (para não criar outro a cada boot). */
  pendingBootstrapInvite(): Invite | null {
    const r = this.db
      .prepare(
        `SELECT * FROM invites WHERE created_by IS NULL AND role = 'admin' AND revoked_at IS NULL
         AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1`,
      )
      .get(Date.now()) as InviteRow | undefined;
    return r ? toInvite(r) : null;
  }

  revokeInvite(code: string): boolean {
    const res = this.db
      .prepare("UPDATE invites SET revoked_at = ? WHERE code = ? AND revoked_at IS NULL")
      .run(Date.now(), code);
    return Number(res.changes) > 0;
  }

  /**
   * Consome um uso do convite de forma atômica: só incrementa se ainda for válido.
   * Duas pessoas usando o último uso ao mesmo tempo nunca passam as duas.
   */
  consumeInvite(code: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE invites SET uses = uses + 1
         WHERE code = ? AND revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .run(code, Date.now());
    return Number(res.changes) === 1;
  }

  // ---------- canais ----------

  listChannels(): Channel[] {
    return (
      this.db.prepare("SELECT id, name, kind, position FROM channels ORDER BY position, created_at").all() as unknown as ChannelRow[]
    ).map(toChannel);
  }

  channelById(id: string): Channel | null {
    const r = this.db.prepare("SELECT id, name, kind, position FROM channels WHERE id = ?").get(id) as
      | ChannelRow
      | undefined;
    return r ? toChannel(r) : null;
  }

  createChannel(name: string, kind: ChannelKind): Channel {
    const id = randomUUID();
    const { next } = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM channels")
      .get() as { next: number };
    this.db
      .prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, kind, next, Date.now());
    return this.channelById(id)!;
  }

  updateChannel(id: string, p: { name?: string; position?: number }): Channel | null {
    this.db
      .prepare("UPDATE channels SET name = COALESCE(?, name), position = COALESCE(?, position) WHERE id = ?")
      .run(p.name ?? null, p.position ?? null, id);
    return this.channelById(id);
  }

  /** Apaga o canal e devolve os IDs dos anexos que precisam sair do disco. */
  deleteChannel(id: string): string[] {
    return transaction(this.db, () => {
      const ids = (
        this.db
          .prepare(
            `SELECT a.id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.channel_id = ?`,
          )
          .all(id) as { id: string }[]
      ).map((r) => r.id);
      this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
      return ids;
    });
  }

  // ---------- mensagens ----------

  listMessages(channelId: string, before: number | undefined, limit: number): Message[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
      )
      .all(channelId, before ?? Number.MAX_SAFE_INTEGER, limit) as unknown as MessageRow[];
    rows.reverse();
    return this.hydrate(rows);
  }

  messageById(id: number): Message | null {
    const r = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    return r ? this.hydrate([r])[0]! : null;
  }

  /**
   * Cria a mensagem e vincula os anexos numa transação.
   * Só vincula anexos enviados pelo próprio autor e ainda livres; devolve null se algum não puder.
   */
  createMessage(m: { channelId: string; authorId: string; content: string; attachmentIds: string[] }): Message | null {
    return transaction(this.db, () => {
      const res = this.db
        .prepare("INSERT INTO messages (channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?)")
        .run(m.channelId, m.authorId, m.content, Date.now());
      const messageId = Number(res.lastInsertRowid);
      const link = this.db.prepare(
        "UPDATE attachments SET message_id = ? WHERE id = ? AND uploader_id = ? AND message_id IS NULL",
      );
      for (const attachmentId of new Set(m.attachmentIds)) {
        if (Number(link.run(messageId, attachmentId, m.authorId).changes) !== 1) {
          throw new AttachmentLinkError(attachmentId);
        }
      }
      return this.messageById(messageId);
    });
  }

  editMessage(id: number, content: string): Message | null {
    this.db.prepare("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?").run(content, Date.now(), id);
    return this.messageById(id);
  }

  /** Apaga a mensagem e devolve os IDs dos anexos a remover do disco. */
  deleteMessage(id: number): string[] {
    return transaction(this.db, () => {
      const ids = (
        this.db.prepare("SELECT id FROM attachments WHERE message_id = ?").all(id) as { id: string }[]
      ).map((r) => r.id);
      this.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
      return ids;
    });
  }

  private hydrate(rows: MessageRow[]): Message[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const atts = this.db
      .prepare(`SELECT * FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at`)
      .all(...ids) as unknown as AttachmentRow[];
    const byMessage = new Map<number, Attachment[]>();
    for (const a of atts) {
      const list = byMessage.get(a.message_id!) ?? [];
      list.push(publicAttachment(toAttachment(a)));
      byMessage.set(a.message_id!, list);
    }
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      content: r.content,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      attachments: byMessage.get(r.id) ?? [],
    }));
  }

  // ---------- anexos ----------

  insertAttachment(a: {
    id: string;
    uploaderId: string;
    filename: string;
    mime: string;
    size: number;
    inline: boolean;
  }): Attachment {
    this.db
      .prepare(
        `INSERT INTO attachments (id, uploader_id, filename, mime, size, inline, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.uploaderId, a.filename, a.mime, a.size, a.inline ? 1 : 0, Date.now());
    return publicAttachment(this.attachmentById(a.id)!);
  }

  attachmentById(id: string): AttachmentRecord | null {
    const r = this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as AttachmentRow | undefined;
    return r ? toAttachment(r) : null;
  }

  /** Remove anexos enviados mas nunca usados numa mensagem, mais antigos que `olderThanMs`. */
  deleteOrphanAttachments(olderThanMs: number): string[] {
    return transaction(this.db, () => {
      const cutoff = Date.now() - olderThanMs;
      const ids = (
        this.db
          .prepare("SELECT id FROM attachments WHERE message_id IS NULL AND created_at < ?")
          .all(cutoff) as { id: string }[]
      ).map((r) => r.id);
      this.db.prepare("DELETE FROM attachments WHERE message_id IS NULL AND created_at < ?").run(cutoff);
      return ids;
    });
  }

  allAttachmentIds(): Set<string> {
    return new Set((this.db.prepare("SELECT id FROM attachments").all() as { id: string }[]).map((r) => r.id));
  }
}

export class AttachmentLinkError extends Error {
  constructor(readonly attachmentId: string) {
    super(`Anexo inválido: ${attachmentId}`);
  }
}
