/**
 * Acesso a dados. Todo SQL do app mora aqui, com parâmetros posicionais (sem concatenação).
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  DEFAULT_LOOK,
  LIMITS,
  lookSchema,
  PERMISSIONS,
  RODA_TEMPLATES,
  userStatusSchema,
  type Permission,
  type Roda,
  type RodaRole,
  type RodaSummary,
  type Attachment,
  type Channel,
  type ChannelKind,
  type ClientErrorEntry,
  type ClientErrorKind,
  type Conversation,
  type FriendEntry,
  type Invite,
  type Message,
  type MessageReference,
  type ProfileLook,
  type PublicUser,
  type Reaction,
  type Role,
  type SearchResult,
  type SoundboardSound,
  type UserStatus,
} from "@resenha/shared";
import { transaction, type Db } from "./db.ts";
import { ftsQuery, makeSnippet, MARK_END, MARK_START } from "./search.ts";

/** Erros guardados para o painel do admin (os mais antigos saem). */
const CLIENT_ERRORS_KEEP = 500;

interface SoundRow {
  id: string;
  name: string;
  emoji: string;
  uploader_id: string;
  mime: string;
  size: number;
  created_at: number;
}

const toSound = (r: SoundRow): SoundboardSound => ({
  id: r.id,
  name: r.name,
  emoji: r.emoji,
  uploaderId: r.uploader_id,
  url: `/api/sounds/${r.id}`,
  createdAt: r.created_at,
});

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  avatar_color: string;
  created_at: number;
  disabled_at: number | null;
  removed_at: number | null;
  avatar_id: string | null;
  avatar_mime: string | null;
  status: string;
  activity: string;
  note: string;
  look: string;
  banner_id: string | null;
  banner_mime: string | null;
  tag: string;
}

export interface UserRecord extends PublicUser {
  passwordHash: string;
  createdAt: number;
  avatarId: string | null;
  avatarMime: string | null;
  bannerId: string | null;
}

/** JSON do banco que não bate com o schema (versão antiga, edição manual) volta ao padrão. */
function parseLook(json: string): ProfileLook {
  try {
    return lookSchema.parse({ ...DEFAULT_LOOK, ...JSON.parse(json) });
  } catch {
    return DEFAULT_LOOK;
  }
}

export type ReactionResult = "added" | "exists" | "limit";

interface ChannelRow {
  id: string;
  name: string;
  kind: ChannelKind;
  position: number;
  conversation: "dm" | "group" | null;
  roda_id: string | null;
}

interface RoleRow {
  id: string;
  roda_id: string;
  name: string;
  color: string;
  perms: string;
  position: number;
  is_owner: number;
  is_default: number;
}

const ALL_PERMS: Permission[] = [...PERMISSIONS];

const toRole = (r: RoleRow): RodaRole => {
  let perms: Permission[] = [];
  try {
    perms = (JSON.parse(r.perms) as string[]).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
  } catch {
    // perms inválidas no banco: o cargo fica sem poderes (nunca com todos)
  }
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    perms: r.is_owner ? ALL_PERMS : perms,
    position: r.position,
    owner: !!r.is_owner,
    isDefault: !!r.is_default,
  };
};

/** Salas e cargos que cada modelo de roda já traz. */
const RODA_TEMPLATE_CHANNELS: Record<(typeof RODA_TEMPLATES)[number], { text: string[]; voice: string[] }> = {
  amigos: { text: ["geral", "clipes"], voice: ["Resenha"] },
  estudos: { text: ["avisos", "dúvidas"], voice: ["Estudo junto", "Sala 2"] },
  jogos: { text: ["geral", "clipes"], voice: ["Ranked", "Casual"] },
};
const DEFAULT_ROLES: { name: string; color: string; perms: Permission[]; owner?: boolean; isDefault?: boolean }[] = [
  { name: "Dono", color: "#ffb27a", perms: ALL_PERMS, owner: true },
  { name: "Moderação", color: "#7cc4ff", perms: ALL_PERMS.filter((p) => p !== "salas") },
  { name: "Membro", color: "#b4b4bc", perms: ["ver", "enviar", "anexar", "voz", "tela"], isDefault: true },
];

interface MessageRow {
  id: number;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: number;
  edited_at: number | null;
  reply_to: number | null;
}

/** Tamanho do trecho da mensagem original mostrado na citação. */
const REPLY_PREVIEW_CHARS = 200;

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
  roda_id: string | null;
  approval: number;
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
  removed: r.removed_at !== null,
  avatarUrl: r.avatar_id ? avatarUrl(r.avatar_id) : null,
  tag: r.tag,
  status: userStatusSchema.catch("online").parse(r.status),
  activity: r.activity,
  note: r.note,
  look: parseLook(r.look),
  bannerUrl: r.banner_id ? bannerUrl(r.banner_id) : null,
  passwordHash: r.password_hash,
  createdAt: r.created_at,
  avatarId: r.avatar_id,
  avatarMime: r.avatar_mime,
  bannerId: r.banner_id,
});

export const bannerUrl = (id: string) => `/api/banners/${id}`;

/** O id muda a cada foto nova, então a URL pode ficar em cache para sempre. */
export const avatarUrl = (id: string) => `/api/avatars/${id}`;

/** O que quem está de fora vê de uma roda aberta (lista "Abertas para entrar"). */
export const toRodaSummary = (r: Roda): RodaSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  hue: r.hue,
  iconUrl: r.iconUrl,
  bannerUrl: r.bannerUrl,
  bannerX: r.bannerX,
  bannerY: r.bannerY,
  bannerZoom: r.bannerZoom,
  memberCount: Object.keys(r.members).length,
});

export const toPublicUser = (u: UserRecord): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarColor: u.avatarColor,
  role: u.role,
  disabled: u.disabled,
  removed: u.removed,
  avatarUrl: u.avatarUrl,
  tag: u.tag,
  status: u.status,
  activity: u.activity,
  note: u.note,
  look: u.look,
  bannerUrl: u.bannerUrl,
});

/** Nome e cor de quem teve a conta removida, nas mensagens que ficaram. */
export const REMOVED_DISPLAY_NAME = "Ex-membro";
const REMOVED_AVATAR_COLOR = "#6f8792";

const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  position: r.position,
  ...(r.conversation ? { conversation: r.conversation } : {}),
  ...(r.roda_id ? { rodaId: r.roda_id } : {}),
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
  rodaId: r.roda_id,
  approval: !!r.approval,
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
        `INSERT INTO users (id, username, display_name, password_hash, role, avatar_color, created_at, tag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, u.username, u.displayName, u.passwordHash, u.role, u.avatarColor, Date.now(), String(randomInt(10_000)).padStart(4, "0"));
    return this.userById(id)!;
  }

  updateUserProfile(
    id: string,
    p: { displayName?: string; avatarColor?: string; status?: UserStatus; activity?: string; note?: string; look?: ProfileLook },
  ): UserRecord {
    this.db
      .prepare(
        `UPDATE users SET display_name = COALESCE(?, display_name), avatar_color = COALESCE(?, avatar_color),
           status = COALESCE(?, status), activity = COALESCE(?, activity), note = COALESCE(?, note),
           look = COALESCE(?, look)
         WHERE id = ?`,
      )
      .run(
        p.displayName ?? null,
        p.avatarColor ?? null,
        p.status ?? null,
        p.activity ?? null,
        p.note ?? null,
        p.look ? JSON.stringify(p.look) : null,
        id,
      );
    return this.userById(id)!;
  }

  /** Troca a capa (ou remove, com null) e devolve o id da anterior, para apagar o arquivo. */
  setBanner(userId: string, banner: { id: string; mime: string } | null): string | null {
    return transaction(this.db, () => {
      const prev = this.db.prepare("SELECT banner_id FROM users WHERE id = ?").get(userId) as
        | { banner_id: string | null }
        | undefined;
      this.db
        .prepare("UPDATE users SET banner_id = ?, banner_mime = ? WHERE id = ?")
        .run(banner?.id ?? null, banner?.mime ?? null, userId);
      return prev?.banner_id ?? null;
    });
  }

  /** Capa de perfil ou de roda (as duas são servidas por /api/banners/:id). */
  bannerById(id: string): { mime: string } | null {
    const r = this.db
      .prepare("SELECT banner_mime FROM users WHERE banner_id = ? UNION ALL SELECT banner_mime FROM rodas WHERE banner_id = ?")
      .get(id, id) as { banner_mime: string | null } | undefined;
    return r?.banner_mime ? { mime: r.banner_mime } : null;
  }

  /** Quem está invisível (o hub esconde a presença dessas pessoas). */
  invisibleUserIds(): string[] {
    return (this.db.prepare("SELECT id FROM users WHERE status = 'invisivel'").all() as { id: string }[]).map((r) => r.id);
  }

  /** Troca a foto (ou remove, com null) e devolve o id da anterior, para apagar o arquivo. */
  setAvatar(userId: string, avatar: { id: string; mime: string } | null): string | null {
    return transaction(this.db, () => {
      const prev = this.db.prepare("SELECT avatar_id FROM users WHERE id = ?").get(userId) as
        | { avatar_id: string | null }
        | undefined;
      this.db
        .prepare("UPDATE users SET avatar_id = ?, avatar_mime = ? WHERE id = ?")
        .run(avatar?.id ?? null, avatar?.mime ?? null, userId);
      return prev?.avatar_id ?? null;
    });
  }

  /** Foto de perfil ou de roda (as duas são servidas por /api/avatars/:id). */
  avatarById(id: string): { mime: string } | null {
    const r = this.db
      .prepare("SELECT avatar_mime FROM users WHERE avatar_id = ? UNION ALL SELECT icon_mime FROM rodas WHERE icon_id = ?")
      .get(id, id) as { avatar_mime: string | null } | undefined;
    return r?.avatar_mime ? { mime: r.avatar_mime } : null;
  }

  /** Fotos e capas em uso (os dois moram na pasta de avatares; o resto é apagado na limpeza). */
  allAvatarIds(): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT avatar_id AS id FROM users WHERE avatar_id IS NOT NULL
         UNION SELECT banner_id FROM users WHERE banner_id IS NOT NULL
         UNION SELECT banner_id FROM rodas WHERE banner_id IS NOT NULL
         UNION SELECT icon_id FROM rodas WHERE icon_id IS NOT NULL`,
      )
      .all() as { id: string }[];
    return new Set(rows.map((r) => r.id));
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

  /**
   * Remove a conta de vez: sem senha, sem foto e com o nome de usuário liberado para
   * outra pessoa. A linha continua só para as mensagens antigas aparecerem como "Ex-membro".
   * Devolve a foto e os anexos soltos que tinha (para apagar os arquivos), ou null se o usuário
   * não existe ou já foi removido.
   */
  removeUser(
    id: string,
  ): { user: UserRecord; avatarId: string | null; bannerId: string | null; orphanAttachmentIds: string[] } | null {
    return transaction(this.db, () => {
      const before = this.userById(id);
      if (!before || before.removed) return null;
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE users SET username = ?, display_name = ?, password_hash = '!', role = 'member',
             avatar_color = ?, avatar_id = NULL, avatar_mime = NULL, banner_id = NULL, banner_mime = NULL,
             status = 'online', activity = '', note = '', look = '{}',
             disabled_at = COALESCE(disabled_at, ?), removed_at = ?
           WHERE id = ?`,
        )
        .run(`removido-${id.slice(0, 8)}`, REMOVED_DISPLAY_NAME, REMOVED_AVATAR_COLOR, now, now, id);
      // Anexos que ela enviou mas nunca foram para uma mensagem não servem a ninguém.
      const orphans = (
        this.db.prepare("SELECT id FROM attachments WHERE uploader_id = ? AND message_id IS NULL").all(id) as { id: string }[]
      ).map((r) => r.id);
      this.db.prepare("DELETE FROM attachments WHERE uploader_id = ? AND message_id IS NULL").run(id);
      this.db.prepare("DELETE FROM friendships WHERE user_id = ? OR friend_id = ?").run(id, id);
      this.db.prepare("DELETE FROM roda_members WHERE user_id = ?").run(id);
      this.db.prepare("DELETE FROM roda_requests WHERE user_id = ?").run(id);
      return { user: this.userById(id)!, avatarId: before.avatarId, bannerId: before.bannerId, orphanAttachmentIds: orphans };
    });
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

  /** Sem roda: entra na roda principal (a mais antiga). */
  createInvite(i: {
    code: string;
    role: Role;
    maxUses: number;
    expiresAt: number | null;
    createdBy: string | null;
    rodaId?: string | null;
    approval?: boolean;
  }): Invite {
    this.db
      .prepare(
        `INSERT INTO invites (code, role, max_uses, expires_at, created_at, created_by, roda_id, approval)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        i.code,
        i.role,
        i.maxUses,
        i.expiresAt,
        Date.now(),
        i.createdBy,
        i.rodaId ?? this.defaultRodaId(),
        i.approval ? 1 : 0,
      );
    return this.inviteByCode(i.code)!;
  }

  /** Convites ainda válidos de uma roda. */
  listRodaInvites(rodaId: string): Invite[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM invites WHERE roda_id = ? AND revoked_at IS NULL AND uses < max_uses
           AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC`,
        )
        .all(rodaId, Date.now()) as unknown as InviteRow[]
    ).map(toInvite);
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

  /** Salas das rodas (as conversas privadas ficam de fora); com `rodaId`, só as daquela roda. */
  listChannels(rodaId?: string): Channel[] {
    const cols = "id, name, kind, position, conversation, roda_id";
    const rows = rodaId
      ? this.db
          .prepare(`SELECT ${cols} FROM channels WHERE roda_id = ? ORDER BY position, created_at`)
          .all(rodaId)
      : this.db
          .prepare(`SELECT ${cols} FROM channels WHERE conversation IS NULL ORDER BY position, created_at`)
          .all();
    return (rows as unknown as ChannelRow[]).map(toChannel);
  }

  /** As salas que a pessoa vê: das rodas em que ela está, com permissão de ver. */
  listChannelsFor(user: UserRecord): Channel[] {
    return this.listRodaIdsFor(user.id)
      .filter((rodaId) => this.permsOf(user, rodaId).has("ver"))
      .flatMap((rodaId) => this.listChannels(rodaId));
  }

  /** Sala de roda ou conversa privada (confira o acesso com canAccess antes de mostrar). */
  channelById(id: string): Channel | null {
    const r = this.db
      .prepare("SELECT id, name, kind, position, conversation, roda_id FROM channels WHERE id = ?")
      .get(id) as ChannelRow | undefined;
    return r ? toChannel(r) : null;
  }

  /**
   * Quem pode ver o canal: os membros da roda com permissão de ver (sala) ou da conversa.
   * Canal sem dono conhecido não aparece para ninguém (na dúvida, nunca para todos).
   */
  channelAudience(channelId: string): string[] | null {
    const r = this.db.prepare("SELECT conversation, roda_id FROM channels WHERE id = ?").get(channelId) as
      | { conversation: string | null; roda_id: string | null }
      | undefined;
    if (!r) return [];
    if (r.conversation) return this.memberIds(channelId);
    if (r.roda_id) return this.rodaViewers(r.roda_id);
    return [];
  }

  canAccess(userId: string, channelId: string): boolean {
    const audience = this.channelAudience(channelId);
    return audience === null || audience.includes(userId);
  }

  /**
   * O que a pessoa pode fazer neste canal: na conversa privada, o básico (sem moderar os outros);
   * na sala de roda, o que o cargo dela permite. Sem acesso: nada.
   */
  channelPerms(user: Pick<UserRecord, "id" | "role">, channelId: string): Set<Permission> {
    const c = this.channelById(channelId);
    if (!c || !this.canAccess(user.id, channelId)) return new Set();
    if (c.conversation) return new Set<Permission>(["ver", "enviar", "anexar", "voz", "tela"]);
    return c.rodaId ? this.permsOf(user, c.rodaId) : new Set();
  }

  /** Dá para ligar aqui: sala de voz (com permissão de voz) ou conversa privada de que a pessoa participa. */
  canCall(userId: string, channelId: string): boolean {
    const c = this.channelById(channelId);
    const user = this.userById(userId);
    if (!c || !user || (c.kind !== "voice" && !c.conversation)) return false;
    return this.channelPerms(user, channelId).has("voz");
  }

  private memberIds(channelId: string): string[] {
    return (
      this.db.prepare("SELECT user_id FROM channel_members WHERE channel_id = ? ORDER BY joined_at").all(channelId) as {
        user_id: string;
      }[]
    ).map((r) => r.user_id);
  }

  // ---------- rodas ----------

  /** A roda principal (a mais antiga): para onde vão convites e salas sem roda indicada. */
  defaultRodaId(): string | null {
    const r = this.db.prepare("SELECT id FROM rodas ORDER BY created_at, id LIMIT 1").get() as { id: string } | undefined;
    return r?.id ?? null;
  }

  private rolesOf(rodaId: string): RodaRole[] {
    return (
      this.db.prepare("SELECT * FROM roda_roles WHERE roda_id = ? ORDER BY position, id").all(rodaId) as unknown as RoleRow[]
    ).map(toRole);
  }

  roleById(roleId: string): (RodaRole & { rodaId: string }) | null {
    const r = this.db.prepare("SELECT * FROM roda_roles WHERE id = ?").get(roleId) as RoleRow | undefined;
    return r ? { ...toRole(r), rodaId: r.roda_id } : null;
  }

  rodaById(id: string): Roda | null {
    const r = this.db.prepare("SELECT * FROM rodas WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          description: string;
          hue: number;
          privacy: Roda["privacy"];
          icon_id: string | null;
          banner_id: string | null;
          banner_x: number;
          banner_y: number;
          banner_zoom: number;
          created_at: number;
        }
      | undefined;
    if (!r) return null;
    const members = this.db
      .prepare("SELECT user_id, role_id FROM roda_members WHERE roda_id = ? ORDER BY joined_at")
      .all(id) as { user_id: string; role_id: string }[];
    const requests = this.db
      .prepare("SELECT user_id FROM roda_requests WHERE roda_id = ? ORDER BY created_at")
      .all(id) as { user_id: string }[];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      hue: Number(r.hue),
      privacy: r.privacy,
      iconUrl: r.icon_id ? avatarUrl(r.icon_id) : null,
      bannerUrl: r.banner_id ? bannerUrl(r.banner_id) : null,
      bannerX: Number(r.banner_x),
      bannerY: Number(r.banner_y),
      bannerZoom: Number(r.banner_zoom),
      roles: this.rolesOf(id),
      members: Object.fromEntries(members.map((m) => [m.user_id, m.role_id])),
      requests: requests.map((x) => x.user_id),
      createdAt: r.created_at,
    };
  }

  /** Para o terminal: a roda pelo id ou pelo nome (sem diferenciar maiúsculas). */
  rodaByNameOrId(nameOrId: string): Roda | null {
    const byId = this.rodaById(nameOrId);
    if (byId) return byId;
    const all = this.db.prepare("SELECT id, name FROM rodas ORDER BY created_at").all() as { id: string; name: string }[];
    const hit = all.find((r) => r.name.localeCompare(nameOrId, "pt-BR", { sensitivity: "accent" }) === 0);
    return hit ? this.rodaById(hit.id) : null;
  }

  listRodaIdsFor(userId: string): string[] {
    return (
      this.db.prepare("SELECT roda_id FROM roda_members WHERE user_id = ? ORDER BY joined_at").all(userId) as {
        roda_id: string;
      }[]
    ).map((r) => r.roda_id);
  }

  listRodasFor(userId: string): Roda[] {
    return this.listRodaIdsFor(userId)
      .map((id) => this.rodaById(id))
      .filter((r): r is Roda => !!r);
  }

  /** Rodas abertas de que a pessoa ainda não faz parte. */
  openRodasFor(userId: string): RodaSummary[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, (SELECT COUNT(*) FROM roda_members m WHERE m.roda_id = r.id) AS n
         FROM rodas r WHERE r.privacy = 'aberta'
           AND r.id NOT IN (SELECT roda_id FROM roda_members WHERE user_id = ?)
         ORDER BY n DESC, r.created_at`,
      )
      .all(userId) as { id: string }[];
    return rows.map((r) => toRodaSummary(this.rodaById(r.id)!));
  }

  rodaMemberIds(rodaId: string): string[] {
    return (
      this.db.prepare("SELECT user_id FROM roda_members WHERE roda_id = ?").all(rodaId) as { user_id: string }[]
    ).map((r) => r.user_id);
  }

  memberRole(rodaId: string, userId: string): RodaRole | null {
    const r = this.db
      .prepare(
        `SELECT r.* FROM roda_members m JOIN roda_roles r ON r.id = m.role_id WHERE m.roda_id = ? AND m.user_id = ?`,
      )
      .get(rodaId, userId) as RoleRow | undefined;
    return r ? toRole(r) : null;
  }

  /** O que a pessoa pode fazer na roda (nada, se não faz parte). Admin do servidor pode tudo onde está. */
  permsOf(user: Pick<UserRecord, "id" | "role">, rodaId: string): Set<Permission> {
    const role = this.memberRole(rodaId, user.id);
    if (!role) return new Set();
    return new Set(user.role === "admin" ? ALL_PERMS : role.perms);
  }

  /** Quem vê as salas da roda: membros com permissão de ver (e admins do servidor que fazem parte). */
  private rodaViewers(rodaId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT m.user_id, r.*, u.role AS user_role FROM roda_members m
         JOIN roda_roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id WHERE m.roda_id = ?`,
      )
      .all(rodaId) as unknown as (RoleRow & { user_id: string; user_role: Role })[];
    return rows.filter((r) => r.user_role === "admin" || toRole(r).perms.includes("ver")).map((r) => r.user_id);
  }

  createRoda(
    input: { name: string; description: string; privacy: Roda["privacy"]; hue: number },
    ownerId: string,
    template: (typeof RODA_TEMPLATES)[number],
  ): Roda {
    return transaction(this.db, () => {
      const id = randomUUID();
      const now = Date.now();
      this.db
        .prepare("INSERT INTO rodas (id, name, description, hue, privacy, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, input.name, input.description, input.hue, input.privacy, now);
      const insertRole = this.db.prepare(
        `INSERT INTO roda_roles (id, roda_id, name, color, perms, position, is_owner, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let ownerRole = "";
      DEFAULT_ROLES.forEach((r, i) => {
        const roleId = randomUUID();
        if (r.owner) ownerRole = roleId;
        insertRole.run(roleId, id, r.name, r.color, JSON.stringify(r.perms), i, r.owner ? 1 : 0, r.isDefault ? 1 : 0);
      });
      this.db
        .prepare("INSERT INTO roda_members (roda_id, user_id, role_id, joined_at) VALUES (?, ?, ?, ?)")
        .run(id, ownerId, ownerRole, now);
      const t = RODA_TEMPLATE_CHANNELS[template];
      for (const name of t.text) this.createChannel(name, "text", id);
      for (const name of t.voice) this.createChannel(name, "voice", id);
      return this.rodaById(id)!;
    });
  }

  updateRoda(
    id: string,
    p: Partial<Pick<Roda, "name" | "description" | "hue" | "privacy" | "bannerX" | "bannerY" | "bannerZoom">>,
  ): Roda | null {
    this.db
      .prepare(
        `UPDATE rodas SET name = COALESCE(?, name), description = COALESCE(?, description),
           hue = COALESCE(?, hue), privacy = COALESCE(?, privacy), banner_x = COALESCE(?, banner_x),
           banner_y = COALESCE(?, banner_y), banner_zoom = COALESCE(?, banner_zoom) WHERE id = ?`,
      )
      .run(
        p.name ?? null,
        p.description ?? null,
        p.hue ?? null,
        p.privacy ?? null,
        p.bannerX ?? null,
        p.bannerY ?? null,
        p.bannerZoom ?? null,
        id,
      );
    return this.rodaById(id);
  }

  /** Troca a capa ou a foto da roda (null tira); devolve a anterior, para apagar do disco. */
  setRodaImage(rodaId: string, kind: "banner" | "icon", image: { id: string; mime: string } | null): string | null {
    // `kind` é um dos dois nomes fixos acima, nunca texto vindo de fora
    return transaction(this.db, () => {
      const prev = this.db.prepare(`SELECT ${kind}_id AS id FROM rodas WHERE id = ?`).get(rodaId) as
        | { id: string | null }
        | undefined;
      this.db
        .prepare(`UPDATE rodas SET ${kind}_id = ?, ${kind}_mime = ? WHERE id = ?`)
        .run(image?.id ?? null, image?.mime ?? null, rodaId);
      return prev?.id ?? null;
    });
  }

  /** Apaga a roda com as salas e mensagens; devolve as salas (para derrubar chamadas), os anexos e as imagens. */
  deleteRoda(id: string): { channelIds: string[]; attachmentIds: string[]; imageIds: string[] } {
    return transaction(this.db, () => {
      const channelIds = this.listChannels(id).map((c) => c.id);
      const attachmentIds = channelIds.flatMap((c) => this.deleteChannel(c));
      const imageIds = [this.setRodaImage(id, "banner", null), this.setRodaImage(id, "icon", null)].filter(
        (x): x is string => !!x,
      );
      this.db.prepare("DELETE FROM rodas WHERE id = ?").run(id);
      return { channelIds, attachmentIds, imageIds };
    });
  }

  /**
   * Coloca a pessoa na roda com o cargo padrão. Roda sem dono (instalação nova) passa a ter
   * como dono o primeiro admin do servidor que entrar.
   */
  addMember(rodaId: string, userId: string, isServerAdmin = false): void {
    transaction(this.db, () => {
      if (this.memberRole(rodaId, userId)) return;
      const roles = this.rolesOf(rodaId);
      const owner = roles.find((r) => r.owner);
      const hasOwner =
        !!owner && !!this.db.prepare("SELECT 1 FROM roda_members WHERE roda_id = ? AND role_id = ?").get(rodaId, owner.id);
      const role = !hasOwner && isServerAdmin && owner ? owner : (roles.find((r) => r.isDefault) ?? roles.at(-1));
      if (!role) throw new Error("roda sem cargos");
      this.db
        .prepare("INSERT INTO roda_members (roda_id, user_id, role_id, joined_at) VALUES (?, ?, ?, ?)")
        .run(rodaId, userId, role.id, Date.now());
      this.db.prepare("DELETE FROM roda_requests WHERE roda_id = ? AND user_id = ?").run(rodaId, userId);
    });
  }

  removeMember(rodaId: string, userId: string): boolean {
    const res = this.db.prepare("DELETE FROM roda_members WHERE roda_id = ? AND user_id = ?").run(rodaId, userId);
    return Number(res.changes) > 0;
  }

  /** Troca o cargo (nunca para Dono: a posse não se passa por aqui). */
  setMemberRole(rodaId: string, userId: string, roleId: string): boolean {
    const role = this.roleById(roleId);
    if (!role || role.rodaId !== rodaId || role.owner) return false;
    const res = this.db
      .prepare("UPDATE roda_members SET role_id = ? WHERE roda_id = ? AND user_id = ?")
      .run(roleId, rodaId, userId);
    return Number(res.changes) > 0;
  }

  /**
   * Passa a posse: a pessoa nova vira Dono e quem era dono fica com o cargo que ela tinha.
   * Devolve quem era dono (para mandar o estado novo), ou null se a pessoa não está na roda.
   */
  transferOwnership(rodaId: string, toUserId: string): string | null {
    return transaction(this.db, () => {
      const owner = this.rolesOf(rodaId).find((r) => r.owner);
      const target = this.memberRole(rodaId, toUserId);
      if (!owner || !target || target.owner) return null;
      const previous = this.db
        .prepare("SELECT user_id FROM roda_members WHERE roda_id = ? AND role_id = ?")
        .get(rodaId, owner.id) as { user_id: string } | undefined;
      if (previous) {
        this.db
          .prepare("UPDATE roda_members SET role_id = ? WHERE roda_id = ? AND user_id = ?")
          .run(target.id, rodaId, previous.user_id);
      }
      this.db.prepare("UPDATE roda_members SET role_id = ? WHERE roda_id = ? AND user_id = ?").run(owner.id, rodaId, toUserId);
      return previous?.user_id ?? "";
    });
  }

  createRole(rodaId: string, r: { name: string; color: string; perms: Permission[] }): RodaRole {
    const id = randomUUID();
    const { next } = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM roda_roles WHERE roda_id = ?")
      .get(rodaId) as { next: number };
    this.db
      .prepare(
        "INSERT INTO roda_roles (id, roda_id, name, color, perms, position, is_owner, is_default) VALUES (?, ?, ?, ?, ?, ?, 0, 0)",
      )
      .run(id, rodaId, r.name, r.color, JSON.stringify([...new Set(r.perms)]), next);
    return this.roleById(id)!;
  }

  /** Dono: só nome e cor mudam (os poderes são todos, sempre). */
  updateRole(roleId: string, r: { name: string; color: string; perms: Permission[] }): void {
    this.db
      .prepare("UPDATE roda_roles SET name = ?, color = ?, perms = CASE WHEN is_owner = 1 THEN perms ELSE ? END WHERE id = ?")
      .run(r.name, r.color, JSON.stringify([...new Set(r.perms)]), roleId);
  }

  /** Apaga o cargo (não o de Dono nem o padrão); quem tinha volta para o cargo padrão. */
  deleteRole(roleId: string): boolean {
    return transaction(this.db, () => {
      const role = this.roleById(roleId);
      if (!role || role.owner || role.isDefault) return false;
      const fallback = this.rolesOf(role.rodaId).find((r) => r.isDefault);
      if (!fallback) return false;
      this.db.prepare("UPDATE roda_members SET role_id = ? WHERE role_id = ?").run(fallback.id, roleId);
      this.db.prepare("DELETE FROM roda_roles WHERE id = ?").run(roleId);
      return true;
    });
  }

  addRequest(rodaId: string, userId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO roda_requests (roda_id, user_id, created_at) VALUES (?, ?, ?)")
      .run(rodaId, userId, Date.now());
  }

  removeRequest(rodaId: string, userId: string): boolean {
    const res = this.db.prepare("DELETE FROM roda_requests WHERE roda_id = ? AND user_id = ?").run(rodaId, userId);
    return Number(res.changes) > 0;
  }

  // ---------- conversas privadas ----------

  conversationById(id: string): Conversation | null {
    const c = this.db
      .prepare("SELECT id, name, conversation, created_at FROM channels WHERE id = ? AND conversation IS NOT NULL")
      .get(id) as { id: string; name: string; conversation: "dm" | "group"; created_at: number } | undefined;
    if (!c) return null;
    const members = this.db
      .prepare("SELECT user_id, last_read FROM channel_members WHERE channel_id = ? ORDER BY joined_at")
      .all(id) as { user_id: string; last_read: number }[];
    const last = this.db.prepare("SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1").get(id) as
      | MessageRow
      | undefined;
    return {
      id: c.id,
      type: c.conversation,
      name: c.name,
      memberIds: members.map((m) => m.user_id),
      lastMessage: last ? this.hydrate([last])[0]! : null,
      reads: Object.fromEntries(members.map((m) => [m.user_id, Number(m.last_read)])),
      createdAt: c.created_at,
    };
  }

  listConversations(userId: string): Conversation[] {
    const ids = this.db.prepare("SELECT channel_id FROM channel_members WHERE user_id = ?").all(userId) as {
      channel_id: string;
    }[];
    return ids.map((r) => this.conversationById(r.channel_id)).filter((c): c is Conversation => !!c);
  }

  /** Mensagens dos outros que você ainda não leu, por conversa (só as que têm alguma). */
  conversationUnread(userId: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT cm.channel_id AS id, COUNT(m.id) AS n FROM channel_members cm
         JOIN messages m ON m.channel_id = cm.channel_id AND m.id > cm.last_read AND m.author_id <> cm.user_id
         WHERE cm.user_id = ? GROUP BY cm.channel_id`,
      )
      .all(userId) as { id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.id, Number(r.n)]));
  }

  /** A conversa a dois entre essas pessoas, se já existe (só existe uma por par). */
  findDm(a: string, b: string): string | null {
    const r = this.db
      .prepare(
        `SELECT c.id FROM channels c
         JOIN channel_members x ON x.channel_id = c.id AND x.user_id = ?
         JOIN channel_members y ON y.channel_id = c.id AND y.user_id = ?
         WHERE c.conversation = 'dm' LIMIT 1`,
      )
      .get(a, b) as { id: string } | undefined;
    return r?.id ?? null;
  }

  createConversation(type: "dm" | "group", name: string, memberIds: string[]): Conversation {
    return transaction(this.db, () => {
      const id = randomUUID();
      const now = Date.now();
      this.db
        .prepare("INSERT INTO channels (id, name, kind, position, created_at, conversation) VALUES (?, ?, 'text', 0, ?, ?)")
        .run(id, name, now, type);
      const add = this.db.prepare("INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)");
      memberIds.forEach((userId, i) => add.run(id, userId, now + i));
      return this.conversationById(id)!;
    });
  }

  renameConversation(id: string, name: string): void {
    this.db.prepare("UPDATE channels SET name = ? WHERE id = ? AND conversation = 'group'").run(name, id);
  }

  addConversationMembers(id: string, userIds: string[]): void {
    const add = this.db.prepare("INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)");
    transaction(this.db, () => userIds.forEach((u, i) => add.run(id, u, Date.now() + i)));
  }

  /** Marca como lido até a mensagem (nunca volta atrás). Devolve se mudou algo. */
  markRead(channelId: string, userId: string, messageId: number): boolean {
    const res = this.db
      .prepare(
        `UPDATE channel_members SET last_read = ?
         WHERE channel_id = ? AND user_id = ? AND last_read < ?
           AND ? <= (SELECT COALESCE(MAX(id), 0) FROM messages WHERE channel_id = ?)`,
      )
      .run(messageId, channelId, userId, messageId, messageId, channelId);
    return Number(res.changes) > 0;
  }

  /**
   * Sai do grupo. Se não sobrar ninguém, o grupo é apagado e os anexos voltam para serem
   * removidos do disco.
   */
  leaveConversation(channelId: string, userId: string): { remaining: string[]; attachmentIds: string[] } {
    return transaction(this.db, () => {
      this.db.prepare("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?").run(channelId, userId);
      const remaining = this.memberIds(channelId);
      return { remaining, attachmentIds: remaining.length ? [] : this.deleteChannel(channelId) };
    });
  }

  // ---------- amizades ----------

  /**
   * Quem a pessoa quis dizer: "nick#1234", "@usuario" ou só o nick (se for único).
   * Só contas ativas; mais de um resultado = nick repetido, falta o #tag.
   */
  findPeople(query: string): UserRecord[] {
    const q = query.trim();
    const active = this.listUsers().filter((u) => !u.removed && !u.disabled);
    const same = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "accent" }) === 0;
    const tagged = /^(.+)#(\d{4})$/.exec(q);
    if (tagged) return active.filter((u) => u.tag === tagged[2] && same(u.displayName, tagged[1]!.trim()));
    const handle = q.replace(/^@/, "").toLowerCase();
    const byUsername = active.find((u) => u.username === handle);
    if (byUsername) return [byUsername];
    return q.startsWith("@") ? [] : active.filter((u) => same(u.displayName, q));
  }

  private friendshipRow(a: string, b: string) {
    return this.db
      .prepare(
        "SELECT user_id, friend_id, status, created_at FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
      )
      .get(a, b, b, a) as { user_id: string; friend_id: string; status: "pending" | "accepted"; created_at: number } | undefined;
  }

  /** A amizade vista por `viewer` (null = nenhuma relação). */
  friendEntry(viewer: string, other: string): FriendEntry | null {
    const r = this.friendshipRow(viewer, other);
    if (!r) return null;
    const status = r.status === "accepted" ? "friend" : r.user_id === viewer ? "outgoing" : "incoming";
    return { userId: other, status, since: r.created_at };
  }

  listFriends(userId: string): FriendEntry[] {
    const rows = this.db
      .prepare("SELECT user_id, friend_id FROM friendships WHERE user_id = ? OR friend_id = ?")
      .all(userId, userId) as { user_id: string; friend_id: string }[];
    return rows.map((r) => this.friendEntry(userId, r.user_id === userId ? r.friend_id : r.user_id)!);
  }

  areFriends(a: string, b: string): boolean {
    return this.friendshipRow(a, b)?.status === "accepted";
  }

  /** Pede amizade; se o outro já tinha pedido, vira amizade na hora. */
  requestFriend(from: string, to: string): "requested" | "accepted" | "already" {
    return transaction(this.db, () => {
      const r = this.friendshipRow(from, to);
      if (r?.status === "accepted" || (r && r.user_id === from)) return "already";
      if (r) {
        this.db
          .prepare("UPDATE friendships SET status = 'accepted', created_at = ? WHERE user_id = ? AND friend_id = ?")
          .run(Date.now(), to, from);
        return "accepted";
      }
      this.db
        .prepare("INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)")
        .run(from, to, Date.now());
      return "requested";
    });
  }

  /** Aceita o pedido que `other` mandou para `me`. */
  acceptFriend(me: string, other: string): boolean {
    const res = this.db
      .prepare(
        "UPDATE friendships SET status = 'accepted', created_at = ? WHERE user_id = ? AND friend_id = ? AND status = 'pending'",
      )
      .run(Date.now(), other, me);
    return Number(res.changes) > 0;
  }

  /** Recusa, cancela ou desfaz (o que houver entre os dois). */
  removeFriendship(a: string, b: string): boolean {
    const res = this.db
      .prepare("DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)")
      .run(a, b, b, a);
    return Number(res.changes) > 0;
  }

  /** Código do link de amizade (criado na primeira vez que a pessoa pede). */
  friendCode(userId: string): string {
    const r = this.db.prepare("SELECT friend_code FROM users WHERE id = ?").get(userId) as
      | { friend_code: string | null }
      | undefined;
    if (r?.friend_code) return r.friend_code;
    const code = randomBytes(9).toString("base64url");
    this.db.prepare("UPDATE users SET friend_code = ? WHERE id = ?").run(code, userId);
    return code;
  }

  userByFriendCode(code: string): UserRecord | null {
    const r = this.db.prepare("SELECT * FROM users WHERE friend_code = ?").get(code) as UserRow | undefined;
    return r ? toUser(r) : null;
  }

  /** Sala nova no fim da roda (sem roda: na roda principal). */
  createChannel(name: string, kind: ChannelKind, rodaId?: string): Channel {
    const id = randomUUID();
    const roda = rodaId ?? this.defaultRodaId();
    const { next } = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM channels WHERE roda_id IS ?")
      .get(roda) as { next: number };
    this.db
      .prepare("INSERT INTO channels (id, name, kind, position, created_at, roda_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, name, kind, next, Date.now(), roda);
    return this.channelById(id)!;
  }

  updateChannel(id: string, p: { name?: string; position?: number }): Channel | null {
    this.db
      .prepare("UPDATE channels SET name = COALESCE(?, name), position = COALESCE(?, position) WHERE id = ?")
      .run(p.name ?? null, p.position ?? null, id);
    return this.channelById(id);
  }

  /** Grava as posições na ordem dada (quem chama confere que são todas as salas da roda). */
  reorderChannels(ids: string[]): Channel[] {
    transaction(this.db, () => {
      const update = this.db.prepare("UPDATE channels SET position = ? WHERE id = ?");
      ids.forEach((id, position) => update.run(position, id));
    });
    return ids.map((id) => this.channelById(id)!);
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

  /**
   * Faixa contínua para pular até uma mensagem antiga: tudo de `before` (exclusive) até `since`
   * (inclusive), mais `context` mensagens anteriores. Se a faixa passar de `max`, devolve só as
   * `max` mais novas (a mensagem procurada não vem; quem chamou avisa).
   */
  listMessagesSince(
    channelId: string,
    before: number | undefined,
    since: number,
    max: number = LIMITS.jumpMaxMessages,
    context: number = 20,
  ): { messages: Message[]; hasMore: boolean } {
    const top = before ?? Number.MAX_SAFE_INTEGER;
    const range = this.db
      .prepare(`SELECT * FROM messages WHERE channel_id = ? AND id < ? AND id >= ? ORDER BY id DESC LIMIT ?`)
      .all(channelId, top, since, max) as unknown as MessageRow[];
    if (range.length === max) {
      range.reverse();
      return { messages: this.hydrate(range), hasMore: true };
    }
    const floor = range.at(-1)?.id ?? top;
    const older = this.db
      .prepare(`SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?`)
      .all(channelId, floor, context) as unknown as MessageRow[];
    const rows = [...range, ...older].reverse();
    return { messages: this.hydrate(rows), hasMore: older.length === context };
  }

  messageById(id: number): Message | null {
    const r = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    return r ? this.hydrate([r])[0]! : null;
  }

  /**
   * Cria a mensagem e vincula os anexos numa transação.
   * Só vincula anexos enviados pelo próprio autor e ainda livres; devolve null se algum não puder.
   */
  createMessage(m: {
    channelId: string;
    authorId: string;
    content: string;
    attachmentIds: string[];
    replyTo?: number | null;
  }): Message | null {
    return transaction(this.db, () => {
      const res = this.db
        .prepare("INSERT INTO messages (channel_id, author_id, content, created_at, reply_to) VALUES (?, ?, ?, ?, ?)")
        .run(m.channelId, m.authorId, m.content, Date.now(), m.replyTo ?? null);
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

  // ---------- reações ----------

  /** Idempotente: reagir de novo com o mesmo emoji não duplica. */
  addReaction(messageId: number, userId: string, emoji: string): ReactionResult {
    return transaction(this.db, () => {
      const exists = this.db
        .prepare("SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ? AND user_id = ?")
        .get(messageId, emoji, userId);
      if (exists) return "exists";
      const emojiInUse = this.db
        .prepare("SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ? LIMIT 1")
        .get(messageId, emoji);
      if (!emojiInUse) {
        const { n } = this.db
          .prepare("SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?")
          .get(messageId) as { n: number };
        if (n >= LIMITS.reactionsPerMessage) return "limit";
      }
      this.db
        .prepare("INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)")
        .run(messageId, userId, emoji, Date.now());
      return "added";
    });
  }

  /** Devolve true se havia a reação. */
  removeReaction(messageId: number, userId: string, emoji: string): boolean {
    const res = this.db
      .prepare("DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND user_id = ?")
      .run(messageId, emoji, userId);
    return Number(res.changes) > 0;
  }

  reactionsFor(messageId: number): Reaction[] {
    return this.reactionsByMessage([messageId]).get(messageId) ?? [];
  }

  private reactionsByMessage(ids: number[]): Map<number, Reaction[]> {
    const out = new Map<number, Reaction[]>();
    if (ids.length === 0) return out;
    const rows = this.db
      .prepare(
        `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${ids.map(() => "?").join(",")})
         ORDER BY created_at, rowid`,
      )
      .all(...ids) as { message_id: number; emoji: string; user_id: string }[];
    // Map preserva a ordem de inserção: cada emoji fica na posição de quem reagiu primeiro.
    const grouped = new Map<number, Map<string, string[]>>();
    for (const r of rows) {
      const byEmoji = grouped.get(r.message_id) ?? new Map<string, string[]>();
      const users = byEmoji.get(r.emoji) ?? [];
      users.push(r.user_id);
      byEmoji.set(r.emoji, users);
      grouped.set(r.message_id, byEmoji);
    }
    for (const [messageId, byEmoji] of grouped) {
      out.set(messageId, [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds })));
    }
    return out;
  }

  // ---------- busca ----------

  private ftsAvailable: boolean | null = null;

  /** Mensagens que contêm todas as palavras (mais novas primeiro). GIFs ficam de fora. */
  search(opts: { terms: string[]; userId: string; channelId?: string; before?: number; limit: number }): SearchResult[] {
    const { terms, userId, channelId, before, limit } = opts;
    this.ftsAvailable ??= !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'messages_fts'").get();
    // só salas que a pessoa vê e conversas de que participa
    const visible = this.listChannelsFor(this.userById(userId)!).map((c) => c.id);
    const filters = [
      "m.content NOT LIKE 'https://%giphy.com/%'",
      `(m.channel_id IN (SELECT value FROM json_each(?))
        OR m.channel_id IN (SELECT channel_id FROM channel_members WHERE user_id = ?))`,
    ];
    const params: (string | number)[] = [JSON.stringify(visible), userId];
    if (channelId) {
      filters.push("m.channel_id = ?");
      params.push(channelId);
    }
    if (before) {
      filters.push("m.id < ?");
      params.push(before);
    }

    let rows: (MessageRow & { snip: string })[];
    if (this.ftsAvailable) {
      const match = ftsQuery(terms);
      if (!match) return [];
      rows = this.db
        .prepare(
          `SELECT m.*, snippet(messages_fts, 0, ?, ?, '…', 14) AS snip
           FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
           WHERE messages_fts MATCH ? AND ${filters.join(" AND ")}
           ORDER BY m.id DESC LIMIT ?`,
        )
        .all(MARK_START, MARK_END, match, ...params, limit) as unknown as (MessageRow & { snip: string })[];
    } else {
      const likes = terms.map(() => "m.content LIKE ? ESCAPE '\\'");
      const likeParams = terms.map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      rows = (
        this.db
          .prepare(
            `SELECT m.* FROM messages m WHERE ${[...likes, ...filters].join(" AND ")} ORDER BY m.id DESC LIMIT ?`,
          )
          .all(...likeParams, ...params, limit) as unknown as MessageRow[]
      ).map((r) => ({ ...r, snip: makeSnippet(r.content, terms) }));
    }
    const messages = this.hydrate(rows);
    return messages.map((message, i) => ({ message, snippet: rows[i]!.snip }));
  }

  // ---------- erros reportados pelos navegadores ----------

  insertClientError(e: {
    userId: string;
    kind: ClientErrorKind;
    message: string;
    detail: string;
    userAgent: string;
    context: Record<string, string | number | boolean>;
  }): ClientErrorEntry {
    return transaction(this.db, () => {
      const res = this.db
        .prepare(
          `INSERT INTO client_errors (user_id, kind, message, detail, user_agent, context, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(e.userId, e.kind, e.message, e.detail, e.userAgent, JSON.stringify(e.context), Date.now());
      this.db
        .prepare("DELETE FROM client_errors WHERE id <= (SELECT MAX(id) FROM client_errors) - ?")
        .run(CLIENT_ERRORS_KEEP);
      return this.listClientErrors(1).find((x) => x.id === Number(res.lastInsertRowid))!;
    });
  }

  latestClientErrorId(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM client_errors").get() as { id: number };
    return Number(row.id);
  }

  listClientErrors(limit = 200): ClientErrorEntry[] {
    const rows = this.db.prepare("SELECT * FROM client_errors ORDER BY id DESC LIMIT ?").all(limit) as {
      id: number;
      user_id: string;
      kind: ClientErrorKind;
      message: string;
      detail: string;
      user_agent: string;
      context: string;
      created_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      kind: r.kind,
      message: r.message,
      detail: r.detail,
      userAgent: r.user_agent,
      context: safeJson(r.context),
      createdAt: r.created_at,
    }));
  }

  clearClientErrors(): void {
    this.db.prepare("DELETE FROM client_errors").run();
  }

  // ---------- soundboard ----------

  listSounds(): SoundboardSound[] {
    return (this.db.prepare("SELECT * FROM sounds ORDER BY created_at").all() as unknown as SoundRow[]).map(toSound);
  }

  soundById(id: string): (SoundboardSound & { mime: string }) | null {
    const r = this.db.prepare("SELECT * FROM sounds WHERE id = ?").get(id) as SoundRow | undefined;
    return r ? { ...toSound(r), mime: r.mime } : null;
  }

  countSounds(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM sounds").get() as { n: number }).n;
  }

  insertSound(s: { id: string; name: string; emoji: string; uploaderId: string; mime: string; size: number }): SoundboardSound {
    this.db
      .prepare("INSERT INTO sounds (id, name, emoji, uploader_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(s.id, s.name, s.emoji, s.uploaderId, s.mime, s.size, Date.now());
    return this.soundById(s.id)!;
  }

  deleteSound(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM sounds WHERE id = ?").run(id).changes) > 0;
  }

  allSoundIds(): Set<string> {
    return new Set((this.db.prepare("SELECT id FROM sounds").all() as { id: string }[]).map((r) => r.id));
  }

  // ---------- valores do sistema ----------

  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
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
    const reactions = this.reactionsByMessage(ids);
    const replies = this.references(rows.map((r) => r.reply_to).filter((id): id is number => id !== null));
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      content: r.content,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      attachments: byMessage.get(r.id) ?? [],
      reactions: reactions.get(r.id) ?? [],
      replyTo: r.reply_to === null ? null : (replies.get(r.reply_to) ?? deletedReference(r.reply_to)),
    }));
  }

  /** Resumos das mensagens citadas em respostas (uma consulta para a página inteira). */
  private references(ids: number[]): Map<number, MessageReference> {
    const out = new Map<number, MessageReference>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return out;
    const placeholders = unique.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT m.id, m.author_id, substr(m.content, 1, ${REPLY_PREVIEW_CHARS}) AS content,
                (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachments
         FROM messages m WHERE m.id IN (${placeholders})`,
      )
      .all(...unique) as { id: number; author_id: string; content: string; attachments: number }[];
    for (const r of rows) {
      out.set(r.id, { id: r.id, deleted: false, authorId: r.author_id, content: r.content, attachmentCount: r.attachments });
    }
    return out;
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

function safeJson(text: string): Record<string, string | number | boolean> {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string | number | boolean>) : {};
  } catch {
    return {};
  }
}

const deletedReference = (id: number): MessageReference => ({
  id,
  deleted: true,
  authorId: null,
  content: "",
  attachmentCount: 0,
});

export class AttachmentLinkError extends Error {
  constructor(readonly attachmentId: string) {
    super(`Anexo inválido: ${attachmentId}`);
  }
}
