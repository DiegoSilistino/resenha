import type { PublicUser } from "@resenha/shared";
import { initials } from "../lib/format.ts";

interface Props {
  user: Pick<PublicUser, "displayName" | "avatarColor"> | undefined;
  size?: number;
  speaking?: boolean;
  online?: boolean | undefined;
}

/** Avatar com iniciais. Quem está falando "acende" com um halo âmbar. */
export function Avatar({ user, size = 32, speaking = false, online }: Props) {
  const name = user?.displayName ?? "?";
  return (
    <span
      className="avatar"
      data-speaking={speaking || undefined}
      style={{ width: size, height: size, fontSize: size * 0.38, background: user?.avatarColor ?? "var(--muted)" }}
      aria-hidden="true"
    >
      {initials(name)}
      {online !== undefined && <span className="presence-dot" data-online={online || undefined} />}
    </span>
  );
}
