import { memo, useState, type KeyboardEvent } from "react";
import { Download, FileText, Pencil, Trash2, Tv } from "lucide-react";
import type { Attachment, Message } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { api } from "../lib/api.ts";
import { formatBytes, formatFull, formatTime } from "../lib/format.ts";
import { realtime } from "../lib/realtime.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useVoice } from "../voice/controller.ts";
import { renderMessage, youTubeLinks } from "./markdown.tsx";

export const MessageItem = memo(function MessageItem({ message, grouped }: { message: Message; grouped: boolean }) {
  const author = useApp((s) => s.users[message.authorId]);
  const me = useApp((s) => s.me);
  const users = useApp((s) => s.users);
  const voiceChannelId = useVoice((s) => (s.status === "connected" ? s.channelId : null));
  const [editing, setEditing] = useState(false);

  const mine = !!me && me.id === message.authorId;
  const canDelete = mine || (!!me && me.role === "admin");
  const knownUser = (username: string) => Object.values(users).some((u) => u.username === username);
  const ytLinks = voiceChannelId ? youTubeLinks(message.content) : [];

  async function remove() {
    if (!confirm("Apagar esta mensagem? Não dá para desfazer.")) return;
    try {
      await api.deleteMessage(message.id);
    } catch (err) {
      toast.fromError(err);
    }
  }

  return (
    <article className="message" data-grouped={grouped || undefined}>
      <div className="message-gutter">
        {grouped ? (
          <time className="message-hover-time" dateTime={new Date(message.createdAt).toISOString()}>
            {formatTime(message.createdAt)}
          </time>
        ) : (
          <Avatar user={author} size={38} />
        )}
      </div>
      <div className="message-main">
        {!grouped && (
          <header className="message-header">
            <span className="message-author">{author?.displayName ?? "Conta removida"}</span>
            <time dateTime={new Date(message.createdAt).toISOString()} title={formatFull(message.createdAt)}>
              {formatTime(message.createdAt)}
            </time>
          </header>
        )}
        {editing ? (
          <EditBox message={message} onDone={() => setEditing(false)} />
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
        {message.attachments.length > 0 && (
          <div className="attachments">
            {message.attachments.map((a) => (
              <AttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        )}
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
      {!editing && (mine || canDelete) && (
        <div className="message-actions">
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
    </article>
  );
});

function EditBox({ message, onDone }: { message: Message; onDone(): void }) {
  const [text, setText] = useState(message.content);
  const [busy, setBusy] = useState(false);

  async function save() {
    const content = text.trim();
    if (!content || content === message.content) return onDone();
    setBusy(true);
    try {
      await api.editMessage(message.id, content);
      onDone();
    } catch (err) {
      toast.fromError(err);
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") onDone();
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    }
  }

  return (
    <div className="edit-box">
      <textarea
        autoFocus
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
  if (a.inline && a.mime.startsWith("image/")) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="attachment-image">
        <img src={a.url} alt={a.filename} loading="lazy" />
      </a>
    );
  }
  if (a.inline && a.mime.startsWith("video/")) {
    return <video className="attachment-video" src={a.url} controls preload="metadata" />;
  }
  return (
    <a href={a.url} download={a.filename} className="attachment-file">
      <FileText size={22} aria-hidden="true" />
      <span className="attachment-file-name">{a.filename}</span>
      <span className="attachment-file-size">{formatBytes(a.size)}</span>
      <Download size={16} aria-hidden="true" />
    </a>
  );
}
