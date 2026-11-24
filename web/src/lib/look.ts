import type { CSSProperties } from "react";
import { DEFAULT_LOOK, PROFILE_COLORS, type ProfileLook, type PublicUser, type UserStatus } from "@resenha/shared";

export type ShownStatus = UserStatus | "offline";

export const STATUS: Record<ShownStatus, { label: string; color: string }> = {
  online: { label: "Online", color: "#3ecf8e" },
  ausente: { label: "Ausente", color: "#f5b84a" },
  ocupado: { label: "Não perturbe", color: "#ff5a4f" },
  invisivel: { label: "Invisível", color: "#5d5d66" },
  offline: { label: "Offline", color: "#5d5d66" },
};

/** O que aparece para quem olha: você vê o seu status; os outros, offline se não estão conectados. */
export function shownStatus(user: Pick<PublicUser, "status">, online: boolean, isMe: boolean): ShownStatus {
  if (isMe) return user.status;
  if (!online || user.status === "invisivel") return "offline";
  return user.status;
}

/** Linha de baixo do nome nas listas: a atividade, senão o status. */
export function statusLine(user: Pick<PublicUser, "status" | "activity">, shown: ShownStatus): string {
  return user.activity || STATUS[shown].label;
}

export const NICK_FONTS: Record<ProfileLook["font"], string> = {
  onest: "var(--font-ui)",
  mono: "var(--font-mono)",
  larga: "var(--font-display)",
  serif: '"Instrument Serif", serif',
  pixel: '"Silkscreen", var(--font-ui)',
};

/** Quem tem visual: usuário de verdade ou a prévia da tela de personalizar. */
export type LookUser = Pick<PublicUser, "avatarColor"> & { look?: ProfileLook };

export const lookOf = (u: LookUser | undefined): ProfileLook => u?.look ?? DEFAULT_LOOK;

/**
 * Capa posicionada: o ponto (bannerX%, bannerY%) da imagem fica nesse mesmo ponto do quadro e o
 * zoom cresce a partir dele. A mesma conta vale no editor e no cartão, de qualquer largura.
 */
export function bannerImageStyle(look: Pick<ProfileLook, "bannerX" | "bannerY" | "bannerZoom">): CSSProperties {
  const at = `${look.bannerX ?? 50}% ${look.bannerY ?? 50}%`;
  const zoom = look.bannerZoom ?? 1;
  return { objectPosition: at, transformOrigin: at, transform: zoom > 1 ? `scale(${zoom})` : undefined };
}
export const profileColor = (u: LookUser) => lookOf(u).a ?? u.avatarColor;

/**
 * Cores do perfil em variáveis CSS: --pa (principal), --pb (segunda, só no modo duas cores),
 * --pg (fim do degradê do nick) e a fonte do nick. As molduras e o nick leem daqui.
 */
export function lookVars(u: LookUser | undefined): CSSProperties {
  if (!u) return {};
  const look = lookOf(u);
  const a = profileColor(u);
  return {
    "--pa": a,
    "--pb": look.twoTone ? (look.b ?? a) : a,
    "--pg": look.b ?? PROFILE_COLORS[7],
    "--nick-font": NICK_FONTS[look.font],
  } as CSSProperties;
}
