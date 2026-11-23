import { Link, NavLink, useLocation } from "react-router";
import { APP_NAME } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";
import { CallPill } from "./CallPill.tsx";

/** Menções a você ainda não lidas em todos os canais (o número que aparece na aba Rodas). */
function useMentionTotal() {
  return useApp((s) => Object.values(s.mentions).reduce((a, b) => a + b, 0));
}

/** As abas do app: no computador ficam no topo; no celular, no menu de baixo. */
function Tabs({ className }: { className: string }) {
  const mentions = useMentionTotal();
  // Dentro de um canal você está "na roda" (por enquanto só existe uma).
  const inRoda = useLocation().pathname.startsWith("/c/");
  return (
    <nav className={className} aria-label="Seções">
      <NavLink to="/" end className="tab-pill">
        Início
      </NavLink>
      <NavLink to="/roda" className={({ isActive }) => `tab-pill${isActive || inRoda ? " active" : ""}`}>
        Rodas
        {mentions > 0 && (
          <span className="tab-badge" aria-label={`${mentions} ${mentions === 1 ? "menção" : "menções"} a você`}>
            {mentions > 99 ? "99+" : mentions}
          </span>
        )}
      </NavLink>
    </nav>
  );
}

export function TopBar() {
  const me = useApp((s) => s.me);
  return (
    <header className="topbar">
      <Link to="/" className="wordmark topbar-wordmark" aria-label={`${APP_NAME}: início`}>
        {APP_NAME}
      </Link>
      <Tabs className="tabs-top" />
      <div className="topbar-spacer" />
      <CallPill place="top" />
      <button
        type="button"
        className="topbar-me"
        onClick={() => useUi.getState().setSettingsOpen(true)}
        aria-label="Seu perfil e configurações"
        title="Seu perfil e configurações"
      >
        {me && <Avatar user={me} size={40} online />}
      </button>
    </header>
  );
}

/** Menu de baixo do celular, com a chamada em andamento logo acima. */
export function Dock() {
  return (
    <div className="dock-area">
      <CallPill place="bottom" />
      <Tabs className="dock" />
    </div>
  );
}
