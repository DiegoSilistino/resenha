import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CornerUpLeft, Download, FileText, Image as ImageIcon, Pencil, Reply, SmilePlus, Star, Trash2, Tv } from "lucide-react";
import type { Attachment, GifResult, Message, MessageReference } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Nick } from "../components/Nick.tsx";
import { api } from "../lib/api.ts";
import { formatBytes, formatFull, formatTime } from "../lib/format.ts";
import { realtime } from "../lib/realtime.ts";
import { displayNameOf, useApp } from "../state/app.ts";
import { toggleGifFavorite, useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { useVoice } from "../voice/controller.ts";
import { EmojiPicker } from "./EmojiPicker.tsx";
import { InviteCard } from "./InviteCard.tsx";
import { AudioAttachment, ImageAttachment } from "./Media.tsx";
import { emojiName, QUICK_REACTIONS } from "./emojis.ts";
import { renderMessage, youTubeLinks } from "./markdown.tsx";
import { mentionsUser as mentionsUserIn } from "./mentions.ts";
import { gifFromMessage, inviteCodes, parseGifMessage, plainText } from "./plain.ts";
import { ReactionBar, toggleReaction } from "./Reactions.tsx";
import { stickerFromMessage } from "./stickers.ts";

export const MessageItem = memo(function MessageItem({ message, grouped }: { message: Message; grouped: boolean }) {
  const author = useApp((s) => s.users[message.authorId]);
  const me = useApp((s) => s.me);
  const users = useApp((s) => s.users);
  const voiceChannelId = useVoice((s) => (s.status === "connected" ? s.channelId : null));
  const editing = useUi((s) => s.editingId === message.id);
  const setEditing = (on: boolean) => useUi.getState().setEditing(on ? message.id : null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const closePicker = useCallback(() => setPickerAnchor(null), []);
  const recent = useSettings((s) => s.recentEmojis);
  const quick = [...new Set([...recent, ...QUICK_REACTIONS])].slice(0, 3);

  const mine = !!me && me.id === message.authorId;
  const mentionsMeHere = !!me && !mine && (message.replyTo?.authorId === me.id || mentionsUserIn(message.content, me.username));
  const canDelete = mine || (!!me && me.role === "admin");
  const knownUser = (username: string) => Object.values(users).some((u) => u.username === username);
  const ytLinks = voiceChannelId ? youTubeLinks(message.content) : [];
  const gif = parseGifMessage(message.content);
  const sticker = gif ? undefined : stickerFromMessage(message.content);
  const invites = gif ? [] : inviteCodes(message.content);
  const openAuthor = () => author && !author.removed && useUi.getState().openProfile(author.id);

  async function remove() {
    if (!confirm("Apagar esta mensagem? Não dá para desfazer.")) return;
    try {
      await api.deleteMessage(message.id);
    } catch (err) {
      toast.fromError(err);
    }
  }

  return (
    <article
      id={`msg-${message.id}`}
      className="message"
      data-mine={mine || undefined}
      data-grouped={grouped || undefined}
      data-menu-open={pickerAnchor ? true : undefined}
      data-mentions-me={mentionsMeHere || undefined}
    >
      {message.replyTo && <ReplyReference channelId={message.channelId} reference={message.replyTo} />}
      <div className="message-gutter">
        {grouped ? (
          <time className="message-hover-time" dateTime={new Date(message.createdAt).toISOString()}>
            {formatTime(message.createdAt)}
          </time>
        ) : (
          <button type="button" className="avatar-btn" onClick={openAuthor} aria-label={`Perfil de ${author?.displayName ?? "quem enviou"}`}>
            <Avatar user={author} size={36} />
          </button>
        )}
      </div>
      <div className="message-main">
        {!grouped && (
          <header className="message-header">
            <button type="button" className="message-author" onClick={openAuthor}>
              <Nick user={author} fallback="Conta removida" />
            </button>
            <time dateTime={new Date(message.createdAt).toISOString()} title={formatFull(message.createdAt)}>
              {formatTime(message.createdAt)}
            </time>
          </header>
        )}
        {editing ? (
          <EditBox message={message} onDone={() => setEditing(false)} />
        ) : gif ? (
          <GifView src={gif.src} width={gif.width} height={gif.height} favorite={gifFromMessage(message.content)} />
        ) : sticker ? (
          <img className="sticker" src={sticker.src} alt={`Figurinha: ${sticker.name}`} title={sticker.name} decoding="async" />
        ) : (
          message.content && (
            <div className="message-content">
              {renderMessage(message.content, knownUser)}
              {message.editedAt && (
                <span className="message-edited" title={formatFull(message.editedAt)}>
                  {" "}
                  (editado)
                </span>
              )}
            </div>
          )
        )}
        {!editing && invites.map((code) => <InviteCard key={code} code={code} />)}
        {message.attachments.length > 0 && (
          <div className="attachments">
            {message.attachments.map((a) => (
              <AttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        )}
        <ReactionBar message={message} />
        {ytLinks.map((url) => (
          <button
            key={url}
            type="button"
            className="btn btn-small btn-ghost yt-add"
            onClick={() => realtime.send({ type: "watch", channelId: voiceChannelId!, action: { kind: "add", url } })}
          >
            <Tv size={14} aria-hidden="true" /> Pôr no Assistir juntos
          </button>
        ))}
      </div>
      {!editing && (
        <div className="message-actions">
          {quick.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="icon-btn emoji-quick"
              onClick={() => void toggleReaction(message, emoji)}
              aria-label={`Reagir com ${emojiName(emoji)}`}
              title={`Reagir com ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            className="icon-btn"
            onClick={(e) => setPickerAnchor(pickerAnchor ? null : e.currentTarget)}
            aria-label="Adicionar reação"
            title="Adicionar reação"
          >
            <SmilePlus size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              useUi.getState().setReplying(message.channelId, message.id);
              focusComposer();
            }}
            aria-label="Responder"
            title="Responder"
          >
            <Reply size={16} />
          </button>
          {mine && (
            <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label="Editar mensagem">
              <Pencil size={16} />
            </button>
          )}
          {canDelete && (
            <button type="button" className="icon-btn" data-danger onClick={() => void remove()} aria-label="Apagar mensagem">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
      {pickerAnchor && (
        <EmojiPicker
          anchor={pickerAnchor}
          onClose={closePicker}
          onPick={(emoji) => {
            closePicker();
            void toggleReaction(message, emoji);
          }}
        />
      )}
    </article>
  );
});

/** Volta o cursor para a caixa de mensagem do canal aberto. */
export function focusComposer() {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
}

/** "↱ Ana: bora jogar hoje?" acima da resposta; clicar leva até a original. */
function ReplyReference({ channelId, reference: r }: { channelId: string; reference: MessageReference }) {
  const author = useApp((s) => (r.authorId ? s.users[r.authorId] : undefined));
  const users = useApp((s) => s.users);
  if (r.deleted) {
    return (
      <div className="reply-ref" data-deleted>
        <CornerUpLeft size={14} aria-hidden="true" className="reply-ref-icon" />
        <span className="reply-ref-text">A mensagem original foi apagada</span>
      </div>
    );
  }
  const text = plainText(r.content);
  return (
    <button
      type="button"
      className="reply-ref"
      onClick={() => useUi.getState().jumpTo(channelId, r.id)}
      title="Ir para a mensagem respondida"
    >
      <CornerUpLeft size={14} aria-hidden="true" className="reply-ref-icon" />
      <Avatar user={author} size={16} />
      <span className="reply-ref-author">{author?.displayName ?? displayNameOf(users, r.authorId ?? "")}</span>
      <span className="reply-ref-text">
        {text || (
          <>
            <ImageIcon size={13} aria-hidden="true" /> {r.attachmentCount > 1 ? `${r.attachmentCount} anexos` : "anexo"}
          </>
        )}
      </span>
    </button>
  );
}

/**
 * GIF do GIPHY: um MP4 em loop (bem mais leve que .gif), que pausa quando sai da tela.
 * A estrela no canto (ao passar o mouse, como no Discord) põe nos favoritos do seletor.
 */
function GifView({ src, width, height, favorite }: { src: string; width: number; height: number; favorite: GifResult | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const faved = useSettings((s) => !!favorite && s.gifFavorites.some((g) => g.id === favorite.id));
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void el.play().catch(() => undefined);
      else el.pause();
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const scale = Math.min(1, 360 / width, 280 / height);
  return (
    <span className="gif-message">
      <video
        ref={ref}
        className="gif"
        src={src}
        width={Math.round(width * scale)}
        height={Math.round(height * scale)}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-label="GIF"
      />
      {favorite && (
        <button
          type="button"
          className="gif-fav"
          aria-pressed={faved}
          aria-label={faved ? "Tirar dos favoritos" : "Adicionar aos favoritos"}
          title={faved ? "Tirar dos favoritos" : "Adicionar aos favoritos"}
          onClick={() => toggleGifFavorite(favorite)}
        >
          <Star size={16} fill={faved ? "currentColor" : "none"} />
        </button>
      )}
    </span>
  );
}

function EditBox({ message, onDone }: { message: Message; onDone(): void }) {
  const [text, setText] = useState(message.content);
  const [busy, setBusy] = useState(false);

  async function save() {
    const content = text.trim();
    if (!content || content === message.content) return finish();
    setBusy(true);
    try {
      await api.editMessage(message.id, content);
      finish();
    } catch (err) {
      toast.fromError(err);
      setBusy(false);
    }
  }

  function finish() {
    onDone();
    focusComposer();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") finish();
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    }
  }

  return (
    <div className="edit-box">
      <textarea
        autoFocus
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        rows={Math.min(8, text.split("\n").length)}
        aria-label="Editar mensagem"
      />
      <small>Enter salva, Esc cancela</small>
    </div>
  );
}

function AttachmentView({ attachment: a }: { attachment: Attachment }) {
  // vídeo que este navegador não abre (ex.: .mov do iPhone num PC sem o codec) vira o cartão de download
  const [unplayable, setUnplayable] = useState(false);
  if (a.inline && a.mime.startsWith("image/")) return <ImageAttachment a={a} />;
  if (a.inline && a.mime.startsWith("video/") && !unplayable) {
    return (
      <video className="attachment-video" src={a.url} controls playsInline preload="metadata" onError={() => setUnplayable(true)} />
    );
  }
  if (a.inline && a.mime.startsWith("audio/")) return <AudioAttachment a={a} />;
  return (
    <a href={a.url} download={a.filename} className="attachment-file">
      <FileText size={22} aria-hidden="true" />
      <span className="attachment-file-name">{a.filename}</span>
      <span className="attachment-file-size">{formatBytes(a.size)}</span>
      <Download size={16} aria-hidden="true" />
    </a>
  );
}
