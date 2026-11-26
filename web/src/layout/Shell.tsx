import { Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router";
import { BellRing, RefreshCw, X } from "lucide-react";
import { hasUnsentDraft } from "../chat/Composer.tsx";
import { useVoice } from "../voice/state.ts";
import { lazyChunk } from "../lib/chunks.ts";
import { desktop } from "../lib/desktop.ts";
import { notifyPermission, requestNotifyPermission, setNotifyNavigator } from "../lib/notify.ts";
import { unreadTotal, useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { ChatView } from "../chat/ChatView.tsx";
import { ProfileCard } from "../modals/ProfileCard.tsx";
import { ConversationsPage } from "../pages/ConversationsPage.tsx";
import { FriendLinkPage } from "../pages/FriendLinkPage.tsx";
import { FriendsPage } from "../pages/FriendsPage.tsx";
import { HomePage } from "../pages/HomePage.tsx";
import { RodaPage } from "../pages/RodaPage.tsx";
import { RodasPage } from "../pages/RodasPage.tsx";
import { preloadVoice } from "../voice/controller.ts";
import { WatchDock } from "../watch/WatchDock.tsx";
import { AloneInCall, IncomingCall } from "./IncomingCall.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Dock, TopBar } from "./TopBar.tsx";

// Partes que nem todo mundo abre ficam fora do pacote inicial (a tela de voz traz o LiveKit).
const loadVoiceView = () => import("../voice/VoiceView.tsx");
const loadSettings = () => import("../modals/SettingsModal.tsx");
const loadAdmin = () => import("../modals/AdminModal.tsx");
const VoiceView = lazyChunk(() => loadVoiceView().then((m) => m.VoiceView));
const SettingsModal = lazyChunk(() => loadSettings().then((m) => m.SettingsModal));
const AdminModal = lazyChunk(() => loadAdmin().then((m) => m.AdminModal));
const RodaSettingsModal = lazyChunk(() => import("../modals/RodaSettingsModal.tsx").then((m) => m.RodaSettingsModal));
const InviteFriendsDialog = lazyChunk(() => import("../modals/InviteFriendsDialog.tsx").then((m) => m.InviteFriendsDialog));
const NewRodaModal = lazyChunk(() => import("../modals/RodaModals.tsx").then((m) => m.NewRodaModal));
const NewRoomModal = lazyChunk(() => import("../modals/RodaModals.tsx").then((m) => m.NewRoomModal));
const NewGroupModal = lazyChunk(() => import("../modals/NewGroupModal.tsx").then((m) => m.NewGroupModal));
const ShareDialog = lazyChunk(() => import("../modals/ShareDialog.tsx").then((m) => m.ShareDialog));
const loadSearch = () => import("../search/SearchPanel.tsx");
const SearchPanel = lazyChunk(() => loadSearch().then((m) => m.SearchPanel));

/** Depois que a página abriu e ficou ociosa, baixa a voz em segundo plano: entrar na chamada fica instantâneo. */
function useIdlePreload(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const run = () => {
      preloadVoice();
      for (const load of [loadVoiceView, loadSettings, loadAdmin, loadSearch]) void load().catch(() => undefined);
    };
    const timer = setTimeout(() => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 5_000 });
      else run();
    }, 2_000);
    return () => clearTimeout(timer);
  }, [ready]);
}

export function Shell() {
  const ready = useApp((s) => s.ready);
  const connection = useApp((s) => s.connection);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const adminOpen = useUi((s) => s.adminOpen);
  const shareDialogOpen = useUi((s) => s.shareDialogOpen);
  const searchOpen = useUi((s) => s.searchOpen);
  const newGroupOpen = useUi((s) => s.newGroupOpen);
  const rodaSettings = useUi((s) => s.rodaSettings);
  const newRodaOpen = useUi((s) => s.newRodaOpen);
  const newRoom = useUi((s) => s.newRoom);
  const inviteRodaId = useUi((s) => s.inviteRodaId);
  const navigate = useNavigate();
  useDocumentTitle();
  useIdlePreload(ready);

  // Clique numa notificação do Windows abre o canal da mensagem.
  useEffect(() => {
    setNotifyNavigator((path) => void navigate(path));
    return () => setNotifyNavigator(null);
  }, [navigate]);

  if (!ready) {
    return (
      <div className="splash" aria-busy="true">
        <span className="splash-text">Conectando…</span>
      </div>
    );
  }

  return (
    <div className="shell">
      <TopBar />
      <div className="banners">
        {connection !== "online" && (
          <div className="connection-banner" role="status">
            Sem conexão com o servidor. Tentando reconectar…
          </div>
        )}
        <UpdateBanner />
        <NotifyPrompt />
      </div>
      <div className="content">
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="/rodas" element={<RodasPage />} />
          <Route path="/r/:rodaId" element={<RodaPage />} />
          <Route path="/roda" element={<Navigate to="/rodas" replace />} />
          <Route path="/conversas/:id?" element={<ConversationsPage />} />
          <Route path="/amigos" element={<FriendsPage />} />
          <Route path="/amigo/:code" element={<FriendLinkPage />} />
          <Route path="/c/:channelId" element={<ChannelRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Dock />
      <WatchDock />
      <IncomingCall />
      <AloneInCall />
      <ProfileCard />
      <Suspense fallback={null}>
        {settingsOpen && <SettingsModal />}
        {adminOpen && <AdminModal />}
        {shareDialogOpen && <ShareDialog />}
        {searchOpen && <SearchPanel />}
        {newGroupOpen && <NewGroupModal />}
        {rodaSettings && <RodaSettingsModal key={rodaSettings.rodaId + rodaSettings.tab} />}
        {newRodaOpen && <NewRodaModal />}
        {newRoom && <NewRoomModal key={newRoom.rodaId + newRoom.kind} />}
        {inviteRodaId && <InviteFriendsDialog key={inviteRodaId} />}
      </Suspense>
    </div>
  );
}

/**
 * Saiu atualização (deploy): vale para o site e para o app, que abre o mesmo site. Botão para atualizar
 * na hora; e, se a janela estiver escondida (bandeja, outra aba), sem chamada e sem texto por enviar,
 * recarrega sozinho para ninguém ficar na versão velha.
 */
function UpdateBanner() {
  const update = useApp((s) => s.updateAvailable);
  const inCall = useVoice((s) => s.status !== "idle");
  useEffect(() => {
    if (!update) return;
    const reloadIfAway = () => {
      if (document.visibilityState === "hidden" && useVoice.getState().status === "idle" && !hasUnsentDraft()) location.reload();
    };
    reloadIfAway();
    document.addEventListener("visibilitychange", reloadIfAway);
    const stopWatchingCall = useVoice.subscribe(reloadIfAway); // saiu da chamada com a janela escondida
    return () => {
      document.removeEventListener("visibilitychange", reloadIfAway);
      stopWatchingCall();
    };
  }, [update]);

  const appUpdate = useAppUpdateReady();
  // O app novo reabre já com o site novo: um aviso só.
  if (appUpdate) {
    return (
      <div className="notify-prompt" role="status">
        <RefreshCw size={18} aria-hidden="true" />
        <span>Saiu a versão {appUpdate} do app do Resenha.</span>
        <button type="button" className="btn btn-small btn-primary" onClick={() => desktop?.installAppUpdate?.()}>
          {inCall ? "Atualizar (sai da chamada)" : "Atualizar"}
        </button>
      </div>
    );
  }
  if (!update) return null;
  return (
    <div className="notify-prompt" role="status">
      <RefreshCw size={18} aria-hidden="true" />
      <span>Saiu uma atualização do Resenha.</span>
      <button type="button" className="btn btn-small btn-primary" onClick={() => location.reload()}>
        {inCall ? "Atualizar (sai da chamada)" : "Atualizar"}
      </button>
    </div>
  );
}

/** Versão nova do app de desktop já baixada, esperando o clique (null: nenhuma, ou no navegador). */
function useAppUpdateReady(): string | null {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop?.onAppUpdateReady) return;
    void desktop.appUpdateStatus?.().then((s) => s?.ready && setReady(s.ready));
    return desktop.onAppUpdateReady(setReady);
  }, []);
  return ready;
}

/** Sala aberta: painel das salas à esquerda (some no celular) e a conversa ou a chamada. */
function ChannelRoute() {
  const { channelId = "" } = useParams();
  const channel = useApp((s) => s.channels.find((c) => c.id === channelId));
  const isConversation = useApp((s) => !!s.conversations[channelId]);
  // Conversa privada (link de notificação ou busca) tem tela própria.
  if (!channel && isConversation) return <Navigate to={`/conversas/${channelId}`} replace />;
  // Sala apagada (ou link velho): volta para a roda.
  if (!channel) return <Navigate to="/rodas" replace />;
  return (
    <div className="room-layout">
      {channel.rodaId && <Sidebar rodaId={channel.rodaId} />}
      {channel.kind === "voice" ? (
        <Suspense fallback={<main className="main empty-state">Carregando…</main>}>
          <VoiceView key={channel.id} channel={channel} />
        </Suspense>
      ) : (
        <ChatView key={channel.id} channel={channel} />
      )}
    </div>
  );
}

/** "(3) #geral": soma das mensagens novas na frente do título, visível na barra de tarefas. */
function useDocumentTitle() {
  const pageTitle = useUi((s) => s.pageTitle);
  const total = useApp(unreadTotal);
  useEffect(() => {
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${pageTitle}` : pageTitle;
  }, [pageTitle, total]);
}

/** Convite discreto para ativar as notificações do Windows (aparece até a pessoa decidir). */
function NotifyPrompt() {
  const dismissed = useSettings((s) => s.notifyPromptDismissed);
  const mode = useSettings((s) => s.notifyMode);
  const [permission, setPermission] = useState(notifyPermission);
  if (dismissed || mode === "none" || permission !== "default") return null;

  const dismiss = () => useSettings.getState().set({ notifyPromptDismissed: true });
  async function enable() {
    const result = await requestNotifyPermission();
    setPermission(result);
    if (result === "granted") toast.info("Pronto! Você será avisado de mensagens novas com o Resenha minimizado.");
    else if (result === "denied") {
      toast.error("O navegador bloqueou as notificações. Dá para liberar no cadeado ao lado do endereço do site.");
    }
  }

  return (
    <div className="notify-prompt" role="region" aria-label="Notificações">
      <BellRing size={18} aria-hidden="true" />
      <span>Quer ser avisado de mensagens novas quando o Resenha estiver minimizado?</span>
      <button type="button" className="btn btn-small btn-primary" onClick={() => void enable()}>
        Ativar notificações
      </button>
      <button type="button" className="icon-btn" onClick={dismiss} aria-label="Agora não" title="Agora não">
        <X size={16} />
      </button>
    </div>
  );
}
