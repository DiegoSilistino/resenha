import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Migrações em ordem. Nunca edite uma migração já publicada: acrescente outra.
 * A versão aplicada fica em PRAGMA user_version.
 */
export const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    avatar_color  TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    disabled_at   INTEGER
  );

  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent   TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE invites (
    code       TEXT PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    max_uses   INTEGER NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at INTEGER
  );

  CREATE TABLE channels (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('text', 'voice')),
    position   INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id  TEXT NOT NULL REFERENCES users(id),
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER
  );
  CREATE INDEX messages_channel ON messages(channel_id, id);

  CREATE TABLE attachments (
    id          TEXT PRIMARY KEY,
    uploader_id TEXT NOT NULL REFERENCES users(id),
    message_id  INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    inline      INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX attachments_message ON attachments(message_id);
  `,
  /* 2: foto de perfil, reações e pequenos valores do sistema */ `
  ALTER TABLE users ADD COLUMN avatar_id TEXT;
  ALTER TABLE users ADD COLUMN avatar_mime TEXT;

  CREATE TABLE reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id),
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, emoji, user_id)
  );

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  /* 3: respostas. Sem chave estrangeira de propósito: se a original for apagada, a
     resposta continua apontando para ela e mostra "mensagem apagada". */ `
  ALTER TABLE messages ADD COLUMN reply_to INTEGER;
  `,
  /* 4: painel de erros e soundboard */ `
  CREATE TABLE client_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    message    TEXT NOT NULL,
    detail     TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    context    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sounds (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    uploader_id TEXT NOT NULL REFERENCES users(id),
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  `,
  /* 5: contas removidas (a linha fica só para assinar mensagens antigas como "Ex-membro") */ `
  ALTER TABLE users ADD COLUMN removed_at INTEGER;
  `,
  // 6: status, atividade, recado, visual do perfil (JSON validado pelo lookSchema) e capa.
  `
  ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online';
  ALTER TABLE users ADD COLUMN activity TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN note TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN look TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE users ADD COLUMN banner_id TEXT;
  ALTER TABLE users ADD COLUMN banner_mime TEXT;
  `,
  // 7: conversas privadas (canal de texto com membros), amizades e link de amizade.
  // O CHECK de channels.kind não deixa outro tipo; recriar a tabela apagaria as mensagens em
  // cascata, então a conversa é um canal de texto marcado na coluna nova.
  `
  ALTER TABLE channels ADD COLUMN conversation TEXT CHECK (conversation IN ('dm', 'group'));

  CREATE TABLE channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  INTEGER NOT NULL,
    last_read  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, user_id)
  );
  CREATE INDEX channel_members_user ON channel_members (user_id);

  -- uma linha por par: quem pediu (user_id) e quem recebeu (friend_id)
  CREATE TABLE friendships (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );
  CREATE INDEX friendships_friend ON friendships (friend_id);

  ALTER TABLE users ADD COLUMN friend_code TEXT;
  CREATE UNIQUE INDEX users_friend_code ON users (friend_code);
  `,
  // 8: rodas (grupos com salas, cargos e membros). O grupo que já existia vira a roda "Resenha":
  // o admin mais antigo é o Dono, os outros admins ficam na Moderação e o resto como Membro.
  `
  CREATE TABLE rodas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    hue         INTEGER NOT NULL,
    privacy     TEXT NOT NULL CHECK (privacy IN ('privada', 'aberta')),
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE roda_roles (
    id         TEXT PRIMARY KEY,
    roda_id    TEXT NOT NULL REFERENCES rodas(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    perms      TEXT NOT NULL,
    position   INTEGER NOT NULL,
    is_owner   INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX roda_roles_roda ON roda_roles (roda_id);

  CREATE TABLE roda_members (
    roda_id   TEXT NOT NULL REFERENCES rodas(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id   TEXT NOT NULL REFERENCES roda_roles(id),
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (roda_id, user_id)
  );
  CREATE INDEX roda_members_user ON roda_members (user_id);

  CREATE TABLE roda_requests (
    roda_id    TEXT NOT NULL REFERENCES rodas(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (roda_id, user_id)
  );

  ALTER TABLE channels ADD COLUMN roda_id TEXT REFERENCES rodas(id) ON DELETE CASCADE;
  ALTER TABLE invites ADD COLUMN roda_id TEXT REFERENCES rodas(id) ON DELETE CASCADE;
  ALTER TABLE invites ADD COLUMN approval INTEGER NOT NULL DEFAULT 0;

  INSERT INTO rodas (id, name, description, hue, privacy, created_at)
    VALUES ('resenha', 'Resenha', '', 122, 'privada', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  INSERT INTO roda_roles (id, roda_id, name, color, perms, position, is_owner, is_default) VALUES
    ('resenha-dono', 'resenha', 'Dono', '#ffb27a',
     '["ver","enviar","anexar","voz","tela","convidar","salas","expulsar"]', 0, 1, 0),
    ('resenha-mod', 'resenha', 'Moderação', '#7cc4ff',
     '["ver","enviar","anexar","voz","tela","convidar","expulsar"]', 1, 0, 0),
    ('resenha-membro', 'resenha', 'Membro', '#b4b4bc', '["ver","enviar","anexar","voz","tela"]', 2, 0, 1);
  INSERT INTO roda_members (roda_id, user_id, role_id, joined_at)
    SELECT 'resenha', u.id,
      CASE
        WHEN u.id = (SELECT id FROM users WHERE role = 'admin' AND removed_at IS NULL ORDER BY created_at LIMIT 1)
          THEN 'resenha-dono'
        WHEN u.role = 'admin' THEN 'resenha-mod'
        ELSE 'resenha-membro'
      END,
      u.created_at
    FROM users u WHERE u.removed_at IS NULL;
  UPDATE channels SET roda_id = 'resenha' WHERE conversation IS NULL;
  UPDATE invites SET roda_id = 'resenha';
  `,
  // 9: tag de 4 números que separa nicks iguais ("bia#0912"), sorteada para quem já existe.
  `
  ALTER TABLE users ADD COLUMN tag TEXT NOT NULL DEFAULT '0000';
  UPDATE users SET tag = printf('%04d', abs(random()) % 10000);
  `,
  // 10: capa da roda (imagem ou GIF, na pasta das fotos), com posição e zoom como a do perfil.
  `
  ALTER TABLE rodas ADD COLUMN banner_id TEXT;
  ALTER TABLE rodas ADD COLUMN banner_mime TEXT;
  ALTER TABLE rodas ADD COLUMN banner_x REAL NOT NULL DEFAULT 50;
  ALTER TABLE rodas ADD COLUMN banner_y REAL NOT NULL DEFAULT 50;
  ALTER TABLE rodas ADD COLUMN banner_zoom REAL NOT NULL DEFAULT 1;
  `,
  // 11: foto da roda (no lugar das iniciais), na pasta das fotos como a do perfil.
  `
  ALTER TABLE rodas ADD COLUMN icon_id TEXT;
  ALTER TABLE rodas ADD COLUMN icon_mime TEXT;
  `,
  // 12: loja (moedas, dia do bônus, moedas de call no dia, itens comprados), feedback implementado
  // e avisos guardados para a pessoa.
  `
  ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN daily_on TEXT;
  ALTER TABLE users ADD COLUMN voice_on TEXT;
  ALTER TABLE users ADD COLUMN voice_coins INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE user_items (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item TEXT NOT NULL,
    bought_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item)
  );
  ALTER TABLE client_errors ADD COLUMN done_at INTEGER;
  CREATE TABLE notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX notices_user ON notices(user_id);
  `,
];

/**
 * Índice de busca (FTS5, sem diferenciar acentos e maiúsculas). Fica fora das migrações
 * numeradas de propósito: se um dia o SQLite vier sem FTS5, o app sobe do mesmo jeito e a
 * busca usa LIKE. Devolve se o índice está disponível.
 */
export function ensureSearchIndex(db: Db): boolean {
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'messages_fts'").get();
    if (exists) return true;
    transaction(db, () => {
      db.exec(`
        CREATE VIRTUAL TABLE messages_fts USING fts5(
          content, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
        CREATE TRIGGER messages_fts_au AFTER UPDATE OF content ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
      `);
    });
    return true;
  } catch {
    return false;
  }
}

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  backupBeforeMigrating(db, file);
  migrate(db);
  ensureSearchIndex(db);
  return db;
}

/**
 * Antes de mudar a estrutura de um banco que já tem dados, guarda uma cópia em
 * DATA_DIR/backups/resenha-antes-da-vN-<data>.db. Se a atualização der errado, é só voltar.
 */
function backupBeforeMigrating(db: Db, file: string): void {
  if (file === ":memory:") return;
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (user_version === 0 || user_version >= MIGRATIONS.length) return;
  const dir = path.join(path.dirname(path.resolve(file)), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  db.prepare("VACUUM INTO ?").run(path.join(dir, `resenha-antes-da-v${MIGRATIONS.length}-${stamp}.db`));
}

export function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Executa `fn` numa transação; desfaz tudo se lançar erro. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
