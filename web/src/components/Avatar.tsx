import { useState } from "react";
import type { PublicUser } from "@resenha/shared";
import { initials } from "../lib/format.ts";
import { avatarImageStyle, lookOf, lookVars, type LookUser } from "../lib/look.ts";

interface Props {
  user:
    | (Pick<PublicUser, "displayName" | "avatarColor"> &
        LookUser & { avatarUrl?: string | null; status?: PublicUser["status"] })
    | undefined;
  size?: number;
  speaking?: boolean;
  /** Mostra a bolinha de status: false = offline; true = o status da pessoa. */
  online?: boolean | undefined;
  /** Sem moldura (ex.: rostinhos empilhados, onde o anel atrapalha). */
  plain?: boolean;
}

/** Foto de perfil ou iniciais sobre a cor escolhida, com a moldura do perfil. Quem está falando ganha um halo lima. */
export function Avatar({ user, size = 32, speaking = false, online, plain = false }: Props) {
  const name = user?.displayName ?? "?";
  // Foto que falhou ao carregar (ex.: acabou de ser trocada) cai nas iniciais em vez de ícone quebrado.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photo = user?.avatarUrl && user.avatarUrl !== failedUrl ? user.avatarUrl : null;
  const look = lookOf(user);
  const frame = plain ? "nenhuma" : look.frame;
  const dot = online === undefined ? null : online ? (user?.status ?? "online") : "offline";
  return (
    <span
      className="avatar"
      data-speaking={speaking || undefined}
      data-photo={photo ? true : undefined}
      data-frame={frame === "nenhuma" ? undefined : frame}
      data-deco={(!plain && look.deco) || undefined}
      style={{
        ...lookVars(user),
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: photo ? "var(--panel-2)" : (user?.avatarColor ?? "var(--muted)"),
      }}
      aria-hidden="true"
    >
      {photo ? (
        // o recorte redondo fica no invólucro: o zoom da foto animada não vaza do círculo
        <span className="avatar-clip">
          <img
            src={photo}
            alt=""
            width={size}
            height={size}
            decoding="async"
            draggable={false}
            style={avatarImageStyle(look)}
            onError={() => setFailedUrl(photo)}
          />
        </span>
      ) : (
        initials(name)
      )}
      {dot && <span className="presence-dot" data-status={dot} />}
    </span>
  );
}
