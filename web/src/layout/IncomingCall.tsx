import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Phone, PhoneCall, PhoneOff } from "lucide-react";
import { Avatar } from "../components/Avatar.tsx";
import { realtime } from "../lib/realtime.ts";
import { loopSound } from "../lib/sounds.ts";
import { conversationTitle, displayNameOf, useApp } from "../state/app.ts";
import { joinVoice } from "../voice/controller.ts";
import { useVoice } from "../voice/state.ts";

/**
 * Chamada recebida, como no Discord: em qualquer tela do app, com o toque em loop, até atender, recusar,
 * quem ligou desistir ou dar o tempo (o servidor decide quando para de tocar).
 */
export function IncomingCall() {
  const meId = useApp((s) => (s.me ? s.me.id : null));
  const rings = useApp((s) => s.rings);
  const users = useApp((s) => s.users);
  const conversations = useApp((s) => s.conversations);
  // já nesta chamada (ex.: reconectando): não toca para você mesmo
  const inCall = useVoice((s) => (s.status !== "idle" ? s.channelId : null));
  const navigate = useNavigate();
  const entry = Object.entries(rings).find(([id, r]) => meId && r.pending.includes(meId) && id !== inCall);
  if (!entry || !meId) return null;
  const [id, ring] = entry;
  const conv = conversations[id];

  const answer = () => {
    void navigate(`/conversas/${id}`);
    void joinVoice(id);
  };
  const decline = () => {
    realtime.send({ type: "call.decline", channelId: id });
    // some na hora; o servidor confirma parando o toque nos seus outros aparelhos
    useApp.getState().applyEvent({ type: "call.ring", channelId: id, ring: { ...ring, pending: ring.pending.filter((p) => p !== meId) } });
  };

  return (
    <RingDialog
      key={id}
      caller={users[ring.callerId]}
      name={displayNameOf(users, ring.callerId)}
      sub={conv?.type === "group" ? `está ligando em ${conversationTitle(conv, users, meId)}` : "está te ligando…"}
      onAnswer={answer}
      onDecline={decline}
    />
  );
}

/**
 * Diálogo nativo aberto por cima de tudo (até de outra janela aberta, como as Configurações): a pessoa
 * atende ou recusa. Esc não recusa sem querer; o toque dura enquanto ele está na tela.
 */
function RingDialog({
  caller,
  name,
  sub,
  onAnswer,
  onDecline,
}: {
  caller: Parameters<typeof Avatar>[0]["user"];
  name: string;
  sub: string;
  onAnswer(): void;
  onDecline(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const keep = (e: Event) => e.preventDefault();
    dialog.addEventListener("cancel", keep);
    const stopRing = loopSound("ring", 2_400);
    return () => {
      stopRing();
      dialog.removeEventListener("cancel", keep);
      dialog.close();
    };
  }, []);

  return (
    <dialog ref={ref} className="incoming-call" aria-labelledby="incoming-call-title" aria-describedby="incoming-call-sub">
      <span className="incoming-call-avatar">
        <Avatar user={caller} size={80} />
      </span>
      <strong id="incoming-call-title" className="incoming-call-name">
        {name}
      </strong>
      <span id="incoming-call-sub" className="incoming-call-sub">
        {sub}
      </span>
      <div className="incoming-call-actions">
        <button type="button" className="btn call-decline" onClick={onDecline}>
          <PhoneOff size={18} aria-hidden="true" /> Recusar
        </button>
        <button type="button" className="btn call-accept" onClick={onAnswer}>
          <Phone size={18} aria-hidden="true" /> Atender
        </button>
      </div>
    </dialog>
  );
}

/** Você ligou e ainda não atenderam: "Chamando…" com o tuu de telefone. */
export function OutgoingRing({ channelId }: { channelId: string }) {
  const meId = useApp((s) => (s.me ? s.me.id : null));
  const ring = useApp((s) => s.rings[channelId]);
  const users = useApp((s) => s.users);
  const connected = useVoice((s) => s.status === "connected" && s.channelId === channelId);
  const pending = connected && ring ? ring.pending.filter((p) => p !== meId) : [];
  const ringing = pending.length > 0;

  useEffect(() => (ringing ? loopSound("ringback", 3_000) : undefined), [ringing]);

  if (!ringing) return null;
  return (
    <div className="stage-banner stage-banner-ring" role="status">
      <PhoneCall size={16} aria-hidden="true" /> Chamando {pending.map((p) => displayNameOf(users, p)).join(", ")}…
    </div>
  );
}
