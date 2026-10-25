import { Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { BellRing, X } from "lucide-react";
import { lazyChunk } from "../lib/chunks.ts";
import { notifyPermission, requestNotifyPermission, setNotifyNavigator } from "../lib/notify.ts";
import { unreadTotal, useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { ChatView } from "../chat/ChatView.tsx";
import { preloadVoice } from "../voice/controller.ts";
import { WatchDock } from "../watch/WatchDock.tsx";

// Partes que nem todo mundo abre ficam fora do pacote inicial (a tela de voz traz o LiveKit).
const loadVoiceView = () => import("../voice/VoiceView.tsx");
const loadSettings = () => import("../modals/SettingsModal.tsx");
const loadAdmin = () => import("../modals/AdminModal.tsx");
const VoiceView = lazyChunk(() => loadVoiceView().then((m) => m.VoiceView));
const SettingsModal = lazyChunk(() => loadSettings().then((m) => m.SettingsModal));
const AdminModal = lazyChunk(() => loadAdmin().then((m) => m.AdminModal));
const ShareDialog = lazyChunk(() => import("../modals/ShareDialog.tsx").then((m) => m.ShareDialog));

/** Depois que a página abriu e ficou ociosa, baixa a voz em segundo plano: entrar na chamada fica instantâneo. */
function useIdlePreload(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const run = () => {
      preloadVoice();
      for (const load of [loadVoiceView, loadSettings, loadAdmin]) void load().catch(() => undefined);
    };
    const timer = setTimeout(() => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 5_000 });
      else run();
    }, 2_000);
    return () => clearTimeout(timer);
  }, [ready]);
}
import { MemberList } from "./MemberList.tsx";
import { Sidebar } from "./Sidebar.tsx";

export function Shell() {
  const ready = useApp((s) => s.ready);
  const connection = useApp((s) => s.connection);
  const navOpen = useUi((s) => s.navOpen);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const adminOpen = useUi((s) => s.adminOpen);
  const shareDialogOpen = useUi((s) => s.shareDialogOpen);
  const location = useLocation();
  const navigate = useNavigate();
  useDocumentTitle();
  useIdlePreload(ready);

  // No celular, a gaveta de canais fecha ao navegar.
  useEffect(() => {
    useUi.getState().setNavOpen(false);
  }, [location.pathname]);

  // Clique numa notificação do Windows abre o canal da mensagem.
  useEffect(() => {
    setNotifyNavigator((path) => void navigate(path));
    return () => setNotifyNavigator(null);
  }, [navigate]);

  if (!ready) {
    return (
      <div className="splash" aria-busy="true">
        <span className="wordmark">Conectando…</span>
      </div>
    );
  }

  return (
    <div className="shell" data-nav-open={navOpen || undefined}>
      <div className="banners">
        {connection !== "online" && (
          <div className="connection-banner" role="status">
            Sem conexão com o servidor. Tentando reconectar…
          </div>
        )}
        <NotifyPrompt />
      </div>
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
      <Suspense fallback={null}>
        {settingsOpen && <SettingsModal />}
        {adminOpen && <AdminModal />}
        {shareDialogOpen && <ShareDialog />}
      </Suspense>
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
  if (channel.kind === "voice") {
    return (
      <Suspense fallback={<main className="main empty-state">Carregando…</main>}>
        <VoiceView key={channel.id} channel={channel} />
      </Suspense>
    );
  }
  return (
    <>
      <ChatView key={channel.id} channel={channel} />
      <MemberList />
    </>
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
