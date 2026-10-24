import { useState } from "react";
import type { PublicUser } from "@resenha/shared";
import { initials } from "../lib/format.ts";

interface Props {
  user: (Pick<PublicUser, "displayName" | "avatarColor"> & { avatarUrl?: string | null }) | undefined;
  size?: number;
  speaking?: boolean;
  online?: boolean | undefined;
}

/** Foto de perfil ou iniciais sobre a cor escolhida. Quem está falando "acende" com um halo âmbar. */
export function Avatar({ user, size = 32, speaking = false, online }: Props) {
  const name = user?.displayName ?? "?";
  // Foto que falhou ao carregar (ex.: acabou de ser trocada) cai nas iniciais em vez de ícone quebrado.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photo = user?.avatarUrl && user.avatarUrl !== failedUrl ? user.avatarUrl : null;
  return (
    <span
      className="avatar"
      data-speaking={speaking || undefined}
      data-photo={photo ? true : undefined}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: photo ? "var(--panel-2)" : (user?.avatarColor ?? "var(--muted)"),
      }}
      aria-hidden="true"
    >
      {photo ? (
        <img src={photo} alt="" width={size} height={size} decoding="async" draggable={false} onError={() => setFailedUrl(photo)} />
      ) : (
        initials(name)
      )}
      {online !== undefined && <span className="presence-dot" data-online={online || undefined} />}
    </span>
  );
}
