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
];

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
