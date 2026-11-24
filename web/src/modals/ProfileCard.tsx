import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { PublicUser, UserStatus } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Modal } from "../components/Modal.tsx";
import { Nick } from "../components/Nick.tsx";
import { api } from "../lib/api.ts";
import { bannerImageStyle, lookOf, lookVars, shownStatus, STATUS, statusLine, type ShownStatus } from "../lib/look.ts";
import { callFriend, openConversationWith } from "../lib/social.ts";
import { FriendRequestActions } from "../pages/FriendsPage.tsx";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";

/** Cartão de quem foi clicado (avatar ou nome). No seu, dá para trocar o status e ir personalizar. */
export function ProfileCard() {
  const id = useUi((s) => s.profileId);
  const user = useApp((s) => (id ? s.users[id] : undefined));
  const meId = useApp((s) => (s.me ? s.me.id : null));
  const online = useApp((s) => (id ? !!s.online[id] : false));
  if (!id || !user) return null;
  const isMe = id === meId;
  const close = () => useUi.getState().openProfile(null);

  return (
    <Modal title={`Perfil de ${user.displayName}`} onClose={close} bare>
      <ProfileCardView user={user} shown={shownStatus(user, online, isMe)}>
        {isMe && (
          <>
            <StatusPicker current={user.status} />
            <div className="profile-actions profile-actions-wrap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  close();
                  useUi.getState().setSettingsOpen(true, "profile");
                }}
              >
                Personalizar
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  close();
                  useUi.getState().setSettingsOpen(true, "audio");
                }}
              >
                Configurações
              </button>
              {user.role === "admin" && (
                <button
                  type="button"
                  className="btn btn-outline profile-admin"
                  onClick={() => {
                    close();
                    useUi.getState().setAdminOpen(true);
                  }}
                >
                  Administrar o site
                </button>
              )}
            </div>
          </>
        )}
        {!isMe && !user.removed && <FriendActions userId={id} onDone={close} />}
      </ProfileCardView>
    </Modal>
  );
}

/** No cartão de outra pessoa: conversar e ligar (amigos) ou o pedido de amizade. */
function FriendActions({ userId, onDone }: { userId: string; onDone(): void }) {
  const entry = useApp((s) => s.friends[userId]);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  if (entry?.status === "friend") {
    return (
      <div className="profile-actions profile-actions-wrap">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onDone();
            void openConversationWith([userId], navigate);
          }}
        >
          Mensagem
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            onDone();
            void callFriend(userId, navigate);
          }}
        >
          Ligar
        </button>
        <button
          type="button"
          className="btn btn-small btn-ghost profile-unfriend"
          disabled={busy}
          onClick={() => confirm("Desfazer a amizade?") && void run(() => api.removeFriend(userId))}
        >
          Desfazer amizade
        </button>
      </div>
    );
  }
  if (entry) return <FriendRequestActions entry={entry} />;
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={busy}
      onClick={() => void run(() => api.addFriend(`@${useApp.getState().users[userId]?.username ?? ""}`))}
    >
      Adicionar amigo
    </button>
  );
}

type CardUser = Pick<
  PublicUser,
  "displayName" | "username" | "tag" | "avatarColor" | "avatarUrl" | "status" | "activity" | "note" | "look" | "bannerUrl"
>;

/** O cartão em si: também serve de prévia ao vivo na tela de personalizar. */
export function ProfileCardView({ user, shown, children }: { user: CardUser; shown: ShownStatus; children?: ReactNode }) {
  const look = lookOf(user);
  const image = look.banner === "imagem" && user.bannerUrl;
  return (
    <div className="profile-card" data-two={look.twoTone || undefined} style={lookVars(user)}>
      <div className="profile-banner">{image && <img src={image} alt="" style={bannerImageStyle(look)} />}</div>
      <div className="profile-card-body">
        <span className="profile-avatar">
          <Avatar user={user} size={84} online={shown !== "offline"} />
        </span>
        <div className="profile-names">
          <span className="profile-nick-row">
            <Nick user={user} className="profile-nick" />
            <span className="profile-handle">#{user.tag}</span>
          </span>
          <span className="profile-sub-handle mono-label">@{user.username}</span>
          <span className="profile-sub">
            <span className="status-dot" style={{ background: STATUS[shown].color }} aria-hidden="true" />
            {statusLine(user, shown)}
          </span>
        </div>
        {user.note && (
          <div className="profile-note">
            <span className="mono-label">recado</span>
            <span>{user.note}</span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

const STATUS_CHOICES: UserStatus[] = ["online", "ausente", "ocupado", "invisivel"];

function StatusPicker({ current }: { current: UserStatus }) {
  const [busy, setBusy] = useState(false);
  async function pick(status: UserStatus) {
    if (status === current || busy) return;
    setBusy(true);
    try {
      const { me } = await api.updateMe({ status });
      useApp.getState().setMe(me);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-status">
      <span className="mono-label">seu status</span>
      <div className="status-grid" role="radiogroup" aria-label="Seu status">
        {STATUS_CHOICES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === current}
            className="status-option"
            disabled={busy}
            onClick={() => void pick(s)}
          >
            <span className="status-dot" style={{ background: STATUS[s].color }} aria-hidden="true" />
            {STATUS[s].label}
          </button>
        ))}
      </div>
      <small className="muted">No Invisível você some de "Online agora".</small>
    </div>
  );
}
