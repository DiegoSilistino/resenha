import type { PublicUser } from "@resenha/shared";
import { lookOf, lookVars, type LookUser } from "../lib/look.ts";

/** Nome de exibição com o estilo escolhido no perfil (cor, degradê e fonte). */
export function Nick({
  user,
  className = "",
  fallback = "…",
}: {
  user: (LookUser & Pick<PublicUser, "displayName">) | undefined;
  className?: string;
  fallback?: string;
}) {
  return (
    <span
      className={`nick ${className}`}
      data-style={user ? lookOf(user).nickStyle : undefined}
      data-font={user ? lookOf(user).font : undefined}
      data-fx={(user && lookOf(user).nickFx) || undefined}
      style={lookVars(user)}
    >
      {user?.displayName ?? fallback}
    </span>
  );
}
