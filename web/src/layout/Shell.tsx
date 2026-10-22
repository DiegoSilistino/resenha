import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";
import { ChatView } from "../chat/ChatView.tsx";
import { VoiceView } from "../voice/VoiceView.tsx";
import { WatchDock } from "../watch/WatchDock.tsx";
import { AdminModal } from "../modals/AdminModal.tsx";
import { SettingsModal } from "../modals/SettingsModal.tsx";
import { MemberList } from "./MemberList.tsx";
import { Sidebar } from "./Sidebar.tsx";

export function Shell() {
  const ready = useApp((s) => s.ready);
  const connection = useApp((s) => s.connection);
  const navOpen = useUi((s) => s.navOpen);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const adminOpen = useUi((s) => s.adminOpen);
  const location = useLocation();

  // No celular, a gaveta de canais fecha ao navegar.
  useEffect(() => {
    useUi.getState().setNavOpen(false);
  }, [location.pathname]);

  if (!ready) {
    return (
      <div className="splash" aria-busy="true">
        <span className="wordmark">Conectando…</span>
      </div>
    );
  }

  return (
    <div className="shell" data-nav-open={navOpen || undefined}>
      {connection !== "online" && (
        <div className="connection-banner" role="status">
          Sem conexão com o servidor. Tentando reconectar…
        </div>
      )}
      <Sidebar />
      <button
        type="button"
        className="nav-scrim"
        aria-label="Fechar lista de canais"
        tabIndex={navOpen ? 0 : -1}
        onClick={() => useUi.getState().setNavOpen(false)}
      />
      <Routes>
        <Route path="/c/:channelId" element={<ChannelRoute />} />
        <Route path="*" element={<DefaultChannel />} />
      </Routes>
      <WatchDock />
      {settingsOpen && <SettingsModal />}
      {adminOpen && <AdminModal />}
    </div>
  );
}

function DefaultChannel() {
  const first = useApp((s) => s.channels.find((c) => c.kind === "text") ?? s.channels[0]);
  if (!first) return <main className="main empty-state">Nenhum canal ainda.</main>;
  return <Navigate to={`/c/${first.id}`} replace />;
}

function ChannelRoute() {
  const { channelId = "" } = useParams();
  const channel = useApp((s) => s.channels.find((c) => c.id === channelId));
  if (!channel) return <DefaultChannel />;
  if (channel.kind === "voice") return <VoiceView key={channel.id} channel={channel} />;
  return (
    <>
      <ChatView key={channel.id} channel={channel} />
      <MemberList />
    </>
  );
}
