import path from "node:path";
import { z } from "zod";

const boolFromEnv = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** URL pública do app (usada nos links de convite). */
  PUBLIC_URL: z.url().optional(),
  DATA_DIR: z.string().default("./data"),
  /** Pasta com o build do frontend; se ausente, o servidor só expõe a API. */
  WEB_DIST: z.string().optional(),
  COOKIE_SECURE: boolFromEnv.optional(),
  TRUST_PROXY: boolFromEnv.optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Endereço interno da API do LiveKit (o servidor fala com ele). */
  LIVEKIT_API_URL: z.url().default("http://localhost:7880"),
  /**
   * Endereço que o NAVEGADOR usa para conectar no LiveKit (ws:// ou wss://).
   * Vazio = mesmo domínio do app (o Caddy encaminha /rtc para o LiveKit).
   */
  LIVEKIT_PUBLIC_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
});

export interface Config {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  publicUrl: string;
  dataDir: string;
  uploadsDir: string;
  dbPath: string;
  webDist: string | null;
  cookieSecure: boolean;
  trustProxy: boolean;
  logLevel: string;
  livekit: {
    apiUrl: string;
    publicUrl: string | null;
    apiKey: string;
    apiSecret: string;
  };
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(stripEmpty(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Configuração inválida:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === "production";

  // Em desenvolvimento, `livekit-server --dev` usa exatamente estas credenciais.
  const apiKey = e.LIVEKIT_API_KEY ?? (production ? undefined : "devkey");
  const apiSecret = e.LIVEKIT_API_SECRET ?? (production ? undefined : "secret");
  if (!apiKey || !apiSecret) {
    throw new ConfigError("Defina LIVEKIT_API_KEY e LIVEKIT_API_SECRET em produção.");
  }
  if (production && apiSecret.length < 32) {
    throw new ConfigError("LIVEKIT_API_SECRET precisa ter pelo menos 32 caracteres.");
  }

  const publicUrl = (e.PUBLIC_URL ?? (production ? "" : "http://localhost:5173")).replace(/\/+$/, "");
  if (!publicUrl) throw new ConfigError("Defina PUBLIC_URL em produção (ex.: https://resenha.seudominio.com).");

  const dataDir = path.resolve(e.DATA_DIR);
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    publicUrl,
    dataDir,
    uploadsDir: path.join(dataDir, "uploads"),
    dbPath: path.join(dataDir, "resenha.db"),
    webDist: e.WEB_DIST ? path.resolve(e.WEB_DIST) : null,
    cookieSecure: e.COOKIE_SECURE ?? production,
    trustProxy: e.TRUST_PROXY ?? production,
    logLevel: e.LOG_LEVEL,
    livekit: {
      apiUrl: e.LIVEKIT_API_URL,
      publicUrl: e.LIVEKIT_PUBLIC_URL?.replace(/\/+$/, "") || null,
      apiKey,
      apiSecret,
    },
  };
}

/** Trata `VAR=` (vazio) como ausente, o que é o esperado em arquivos .env. */
function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}
