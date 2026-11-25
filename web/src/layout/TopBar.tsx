import { Link, NavLink, useLocation } from "react-router";
import { Coins } from "lucide-react";
import { APP_NAME } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { unreadConversations, useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";
import { CallPill } from "./CallPill.tsx";

/** Menções a você ainda não lidas em todos os canais (o número que aparece na aba Rodas). */
function useMentionTotal() {
  return useApp((s) => Object.values(s.mentions).reduce((a, b) => a + b, 0));
}

/** As abas do app: no computador ficam no topo; no celular, no menu de baixo. */
function Tabs({ className }: { className: string }) {
  const mentions = useMentionTotal();
  const conversations = useApp(unreadConversations);
  const requests = useApp((s) => Object.values(s.friends).filter((f) => f.status === "incoming").length);
  // Dentro de uma sala ou da página de uma roda, a aba Rodas fica acesa.
  const path = useLocation().pathname;
  const inRoda = path.startsWith("/c/") || path.startsWith("/r/");
  return (
    <nav className={className} aria-label="Seções">
      <NavLink to="/" end className="tab-pill">
        Início
      </NavLink>
      <NavLink to="/conversas" className="tab-pill">
        Conversas
        {conversations > 0 && (
          <span className="tab-badge" aria-label={`${conversations} com mensagem nova`}>
            {conversations}
          </span>
        )}
      </NavLink>
      <NavLink to="/amigos" className="tab-pill">
        Amigos
        {requests > 0 && (
          <span className="tab-badge" aria-label={`${requests} ${requests === 1 ? "pedido" : "pedidos"} de amizade`}>
            {requests}
          </span>
        )}
      </NavLink>
      <NavLink to="/rodas" className={({ isActive }) => `tab-pill${isActive || inRoda ? " active" : ""}`}>
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
  const coins = useApp((s) => s.wallet.coins);
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
        className="topbar-coins"
        onClick={() => useUi.getState().setSettingsOpen(true, "shop")}
        aria-label={`${coins} moedas: abrir a Loja`}
        title="Suas moedas: abrir a Loja"
      >
        <Coins size={16} aria-hidden="true" /> {coins}
      </button>
      <button
        type="button"
        className="topbar-me"
        onClick={() => me && useUi.getState().openProfile(me.id)}
        aria-label="Seu perfil e status"
        title="Seu perfil e status"
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
