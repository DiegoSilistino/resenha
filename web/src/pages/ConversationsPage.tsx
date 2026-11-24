import { Suspense, useEffect } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { LogOut } from "lucide-react";
import { PROFILE_COLORS, type Conversation } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { ChatPanel } from "../chat/ChatPanel.tsx";
import { plainText } from "../chat/plain.ts";
import { BackToRoda } from "../layout/BackToRoda.tsx";
import { api } from "../lib/api.ts";
import { lazyChunk } from "../lib/chunks.ts";
import { formatTime, initials, sameDay } from "../lib/format.ts";
import { shownStatus, statusLine } from "../lib/look.ts";
import { SearchButton } from "../search/SearchButton.tsx";
import {
  conversationChannel,
  conversationTitle,
  displayNameOf,
  otherMember,
  useApp,
} from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { joinVoice, preloadVoice, toggleScreenShare, useVoice } from "../voice/controller.ts";

const VoiceView = lazyChunk(() => import("../voice/VoiceView.tsx").then((m) => m.VoiceView));

const lastAt = (c: Conversation) => c.lastMessage?.createdAt ?? c.createdAt;

/** Conversas: a lista à esquerda e a conversa aberta (ou a chamada dela) à direita. */
export function ConversationsPage() {
  const { id } = useParams();
  const exists = useApp((s) => (id ? !!s.conversations[id] : true));
  useEffect(() => {
    if (!id) useUi.getState().setPageTitle("Conversas");
  }, [id]);
  if (!exists) return <Navigate to="/conversas" replace />;

  return (
    <div className="room-layout conv-layout" data-open={id ? true : undefined}>
      <ConversationList activeId={id} />
      {id ? (
        <ConversationThread key={id} id={id} />
      ) : (
        <main className="main empty-state conv-empty">
          <p>Escolha uma conversa ou chame um amigo para conversar.</p>
        </main>
      )}
    </div>
  );
}

function ConversationList({ activeId }: { activeId: string | undefined }) {
  const conversations = useApp((s) => s.conversations);
  const sorted = Object.values(conversations).sort((a, b) => lastAt(b) - lastAt(a));
  return (
    <aside className="sidebar conv-list" aria-label="Conversas">
      <header className="conv-list-head">
        <h1 className="conv-list-title">Conversas</h1>
        <button type="button" className="btn btn-small btn-outline" onClick={() => useUi.getState().setNewGroupOpen(true)}>
          Novo grupo
        </button>
      </header>
      {sorted.length === 0 ? (
        <p className="conv-list-empty muted">
          Nenhuma conversa ainda. Abra o perfil de um amigo e toque em <strong>Mensagem</strong>, ou vá em{" "}
          <Link to="/amigos">Amigos</Link>.
        </p>
      ) : (
        <ul className="conv-items">
          {sorted.map((c) => (
            <ConversationRow key={c.id} conversation={c} active={c.id === activeId} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function ConversationRow({ conversation: c, active }: { conversation: Conversation; active: boolean }) {
  const meId = useApp((s) => (s.me ? s.me.id : undefined));
  const users = useApp((s) => s.users);
  const unread = useApp((s) => s.unread[c.id] ?? 0);
  const typing = useApp((s) => Object.entries(s.typing[c.id] ?? {}).some(([uid, until]) => uid !== meId && until > Date.now()));
  const last = c.lastMessage;
  const preview = typing
    ? "digitando…"
    : last
      ? `${last.authorId === meId ? "Você: " : c.type === "group" ? `${displayNameOf(users, last.authorId)}: ` : ""}${plainText(last.content) || "anexo"}`
      : "Sem mensagens ainda.";
  return (
    <li>
      <Link to={`/conversas/${c.id}`} className="conv-row" aria-current={active ? "page" : undefined} data-unread={unread > 0 || undefined}>
        <ConversationAvatar conversation={c} size={46} />
        <span className="conv-row-text">
          <span className="conv-row-top">
            <span className="conv-row-name">{conversationTitle(c, users, meId)}</span>
            {last && <span className="mono-label">{shortTime(last.createdAt)}</span>}
          </span>
          <span className="conv-row-bottom">
            <span className="conv-row-preview" data-typing={typing || undefined}>
              {preview}
            </span>
            {unread > 0 && <span className="mention-badge">{unread > 99 ? "99+" : unread}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

const shortTime = (t: number) =>
  sameDay(t, Date.now()) ? formatTime(t) : new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** A dois: o avatar da outra pessoa (com status). Grupo: um quadrado com as iniciais do nome. */
export function ConversationAvatar({ conversation: c, size }: { conversation: Conversation; size: number }) {
  const meId = useApp((s) => (s.me ? s.me.id : undefined));
  const other = useApp((s) => (c.type === "dm" ? s.users[otherMember(c, meId)] : undefined));
  const online = useApp((s) => (other ? !!s.online[other.id] : false));
  if (c.type === "dm") return <Avatar user={other} size={size} online={online} />;
  const hue = PROFILE_COLORS[[...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PROFILE_COLORS.length];
  return (
    <span className="group-avatar" style={{ width: size, height: size, background: hue, fontSize: size * 0.3 }} aria-hidden="true">
      {initials(c.name || "Grupo")}
    </span>
  );
}

function ConversationThread({ id }: { id: string }) {
  const conv = useApp((s) => s.conversations[id])!;
  const meId = useApp((s) => (s.me ? s.me.id : undefined));
  const users = useApp((s) => s.users);
  const other = useApp((s) => (conv.type === "dm" ? s.users[otherMember(conv, meId)] : undefined));
  const otherOnline = useApp((s) => (other ? !!s.online[other.id] : false));
  const callActive = useApp((s) => (s.voice[id]?.length ?? 0) > 0);
  const inThisCall = useVoice((s) => s.channelId === id && s.status !== "idle");
  const navigate = useNavigate();
  const channel = conversationChannel(conv, users, meId);

  useEffect(() => {
    useUi.getState().setPageTitle(channel.name);
  }, [channel.name]);

  // Chamada rolando (ou você nela): a tela de voz, com o chat da conversa ao lado.
  if (callActive || inThisCall) {
    return (
      <Suspense fallback={<main className="main empty-state">Carregando…</main>}>
        <VoiceView channel={channel} />
      </Suspense>
    );
  }

  const sub =
    conv.type === "dm"
      ? other
        ? statusLine(other, shownStatus(other, otherOnline, false))
        : ""
      : `${conv.memberIds.filter((m) => m !== meId).map((m) => displayNameOf(users, m)).join(", ")} e você`;

  async function leave() {
    if (!confirm(`Sair de "${channel.name}"? Você deixa de ver as mensagens do grupo.`)) return;
    try {
      await api.leaveConversation(id);
      void navigate("/conversas", { replace: true });
    } catch (err) {
      toast.fromError(err);
    }
  }

  return (
    <main className="main chat">
      <header className="main-header">
        <BackToRoda to="/conversas" label="Voltar para as conversas" />
        <ConversationAvatar conversation={conv} size={40} />
        <div className="main-titles">
          <h1 className="main-title">{channel.name}</h1>
          <span className="main-sub">{sub}</span>
        </div>
        <div className="header-actions">
          <SearchButton />
          <button type="button" className="btn btn-small btn-outline" onPointerEnter={preloadVoice} onClick={() => void joinVoice(id)}>
            Ligar
          </button>
          <button
            type="button"
            className="btn btn-small btn-primary conv-share"
            onPointerEnter={preloadVoice}
            onClick={async () => {
              await joinVoice(id);
              toggleScreenShare();
            }}
          >
            Mostrar tela
          </button>
          {conv.type === "group" && (
            <button type="button" className="icon-btn icon-btn-round" onClick={() => void leave()} aria-label="Sair do grupo" title="Sair do grupo">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>
      <ChatPanel channel={channel} />
    </main>
  );
}
