import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS, openDatabase } from "../src/db.ts";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const version = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

describe("migrações", () => {
  it("guarda uma cópia do banco antigo antes de migrar, com os dados intactos", () => {
    dir = mkdtempSync(path.join(tmpdir(), "resenha-db-"));
    const file = path.join(dir, "resenha.db");
    const old = new DatabaseSync(file);
    old.exec(MIGRATIONS[0]!);
    old.exec("PRAGMA user_version = 1");
    old.prepare(
      "INSERT INTO users (id, username, display_name, password_hash, role, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("u1", "diego", "Diego", "hash", "admin", "#e8590c", Date.now());
    old.close();

    const db = openDatabase(file);
    expect(version(db)).toBe(MIGRATIONS.length);
    db.close();

    const [copy] = readdirSync(path.join(dir, "backups"));
    expect(copy).toMatch(new RegExp(`^resenha-antes-da-v${MIGRATIONS.length}-\\d{8}-\\d{6}\\.db$`));
    const saved = new DatabaseSync(path.join(dir, "backups", copy!));
    expect(version(saved)).toBe(1);
    expect((saved.prepare("SELECT username FROM users").get() as { username: string }).username).toBe("diego");
    saved.close();
  });

  it("banco novo ou já atualizado não gera cópia", () => {
    dir = mkdtempSync(path.join(tmpdir(), "resenha-db-"));
    const file = path.join(dir, "resenha.db");
    openDatabase(file).close();
    openDatabase(file).close();
    expect(() => readdirSync(path.join(dir, "backups"))).toThrow();
  });
});
