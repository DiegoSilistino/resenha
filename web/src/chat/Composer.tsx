import { useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Paperclip, SendHorizontal, Smile, X } from "lucide-react";
import { LIMITS, type Attachment, type Channel, type GifResult } from "@resenha/shared";
import { api, uploadFile } from "../lib/api.ts";
import { formatBytes } from "../lib/format.ts";
import { realtime } from "../lib/realtime.ts";
import { displayNameOf, useApp } from "../state/app.ts";
import { rememberEmoji } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { EmojiPicker } from "./EmojiPicker.tsx";
import { GifPicker } from "./GifPicker.tsx";
import { parseGifMessage } from "./plain.ts";

export interface ComposerHandle {
  addFiles(files: File[]): void;
}

interface Pending {
  key: number;
  file: File;
  progress: number;
  attachment?: Attachment;
  controller: AbortController;
}

/** Rascunho por canal: trocar de canal e voltar não perde o texto. */
const drafts = new Map<string, string>();
const TYPING_EVERY_MS = 2_500;
let pendingKey = 0;

export function Composer({ channel, ref }: { channel: Channel; ref: Ref<ComposerHandle> }) {
  const [text, setText] = useState(() => drafts.get(channel.id) ?? "");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [picker, setPicker] = useState<{ kind: "emoji" | "gif"; anchor: HTMLElement } | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);
  const gifsEnabled = useApp((s) => s.features.gifs);
  const users = useApp((s) => s.users);

  // Resposta em andamento neste canal (some sozinha se a original for apagada).
  const replyingId = useUi((s) => s.replying[channel.id]);
  const replyTarget = useApp((s) =>
    replyingId ? s.messages[channel.id]?.items.find((m) => m.id === replyingId) : undefined,
  );
  const loaded = useApp((s) => !!s.messages[channel.id]?.loaded);
  useEffect(() => {
    if (replyingId && loaded && !replyTarget) useUi.getState().setReplying(channel.id, null);
  }, [replyingId, replyTarget, loaded, channel.id]);
  const cancelReply = () => useUi.getState().setReplying(channel.id, null);

  useImperativeHandle(ref, () => ({ addFiles }));

  useEffect(() => {
    drafts.set(channel.id, text);
  }, [channel.id, text]);

  // cancela envios em andamento ao sair do canal
  useEffect(() => () => pendingRef.current.forEach((p) => p.controller.abort()), []);

  // Altura automática (até ~10 linhas).
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  function addFiles(files: File[]) {
    const room = LIMITS.attachmentsPerMessage - pendingRef.current.length;
    if (files.length > room) toast.error(`No máximo ${LIMITS.attachmentsPerMessage} arquivos por mensagem.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      if (file.size > LIMITS.uploadMaxBytes) {
        toast.error(`"${file.name}" passa de ${formatBytes(LIMITS.uploadMaxBytes)}.`);
        continue;
      }
      const item: Pending = { key: ++pendingKey, file, progress: 0, controller: new AbortController() };
      setPending((p) => [...p, item]);
      uploadFile(
        file,
        (progress) => setPending((p) => p.map((x) => (x.key === item.key ? { ...x, progress } : x))),
        item.controller.signal,
      )
        .then((attachment) =>
          setPending((p) => p.map((x) => (x.key === item.key ? { ...x, attachment, progress: 1 } : x))),
        )
        .catch((err) => {
          setPending((p) => p.filter((x) => x.key !== item.key));
          if (!item.controller.signal.aborted) toast.fromError(err);
        });
    }
    textarea.current?.focus();
  }

  const uploading = pending.some((p) => !p.attachment);
  const canSend = !sending && !uploading && (text.trim().length > 0 || pending.length > 0);

  async function send() {
    if (!canSend) return;
    const content = text.trim();
    if (content.length > LIMITS.messageMax) {
      toast.error(`A mensagem passou de ${LIMITS.messageMax} caracteres.`);
      return;
    }
    setSending(true);
    try {
      const { message } = await api.sendMessage(
        channel.id,
        content,
        pending.map((p) => p.attachment!.id),
        replyingId,
      );
      useApp.getState().upsertMessage(message);
      lastTyping.current = 0; // a próxima digitação já avisa os outros
      setText("");
      setPending([]);
      cancelReply();
    } catch (err) {
      toast.fromError(err, "Não foi possível enviar");
    } finally {
      setSending(false);
      textarea.current?.focus();
    }
  }

  /** GIF vai na hora, como no Discord (o texto e os anexos da caixa continuam lá). */
  async function sendGif(gif: GifResult) {
    closePicker();
    try {
      const { message } = await api.sendMessage(channel.id, `${gif.mp4Url}#${gif.width}x${gif.height}`, [], replyingId);
      useApp.getState().upsertMessage(message);
      cancelReply();
    } catch (err) {
      toast.fromError(err, "Não foi possível enviar o GIF");
    } finally {
      textarea.current?.focus();
    }
  }

  function insertAtCursor(value: string) {
    const el = textarea.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    onChange(text.slice(0, start) + value + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + value.length, start + value.length);
    });
  }

  /** Seta ↑ com a caixa vazia edita sua última mensagem (hábito do Discord). */
  function editLastOwn(): boolean {
    const s = useApp.getState();
    const meId = s.me ? s.me.id : null;
    const items = s.messages[channel.id]?.items ?? [];
    const last = items.findLast((m) => m.authorId === meId && m.content && !parseGifMessage(m.content));
    if (!last) return false;
    useUi.getState().setEditing(last.id);
    document.getElementById(`msg-${last.id}`)?.scrollIntoView({ block: "nearest" });
    return true;
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "ArrowUp" && !text && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (editLastOwn()) e.preventDefault();
    } else if (e.key === "Escape" && replyingId) {
      e.preventDefault();
      cancelReply();
    }
  }

  function onChange(value: string) {
    setText(value);
    const now = Date.now();
    if (value.trim() && now - lastTyping.current > TYPING_EVERY_MS) {
      lastTyping.current = now;
      realtime.send({ type: "typing", channelId: channel.id });
    }
  }

  const replyAuthor = replyTarget ? displayNameOf(users, replyTarget.authorId) : "a mensagem";

  return (
    <div className="composer" data-replying={replyingId ? true : undefined}>
      {replyingId && (
        <div className="reply-bar">
          <span>
            Respondendo a <strong>{replyAuthor}</strong>
          </span>
          <button type="button" className="icon-btn" onClick={cancelReply} aria-label="Cancelar resposta" title="Cancelar resposta (Esc)">
            <X size={14} />
          </button>
        </div>
      )}
      {pending.length > 0 && (
        <ul className="pending-files">
          {pending.map((p) => (
            <li key={p.key} className="pending-file" data-done={!!p.attachment || undefined}>
              <span className="pending-name">{p.file.name}</span>
              <span className="pending-size">{p.attachment ? formatBytes(p.file.size) : `${Math.round(p.progress * 100)}%`}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remover ${p.file.name}`}
                onClick={() => {
                  p.controller.abort();
                  setPending((list) => list.filter((x) => x.key !== p.key));
                }}
              >
                <X size={14} />
              </button>
              <span className="pending-bar" style={{ transform: `scaleX(${p.progress})` }} />
            </li>
          ))}
        </ul>
      )}
      <div className="composer-row">
        <button
          type="button"
          className="icon-btn"
          onClick={() => fileInput.current?.click()}
          aria-label="Anexar arquivo"
          title="Anexar arquivo"
        >
          <Paperclip size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <textarea
          ref={textarea}
          className="composer-input"
          rows={1}
          value={text}
          placeholder={
            channel.conversation
              ? `Mensagem para ${channel.name}`
              : channel.kind === "voice"
                ? "Mensagem no chat"
                : `Mensagem em #${channel.name}`
          }
          aria-label={
            channel.conversation
              ? `Mensagem para ${channel.name}`
              : channel.kind === "voice"
                ? `Mensagem no chat de ${channel.name}`
                : `Mensagem em #${channel.name}`
          }
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
        />
        {gifsEnabled && (
          <button
            type="button"
            className="icon-btn gif-btn"
            aria-label="Enviar GIF"
            title="Enviar GIF"
            aria-expanded={picker?.kind === "gif"}
            onClick={(e) => setPicker(picker?.kind === "gif" ? null : { kind: "gif", anchor: e.currentTarget })}
          >
            GIF
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label="Inserir emoji"
          title="Inserir emoji"
          aria-expanded={picker?.kind === "emoji"}
          onClick={(e) => setPicker(picker?.kind === "emoji" ? null : { kind: "emoji", anchor: e.currentTarget })}
        >
          <Smile size={20} />
        </button>
        <button
          type="button"
          className="icon-btn send-btn"
          disabled={!canSend}
          onClick={() => void send()}
          aria-label="Enviar"
          title={uploading ? "Aguarde o envio dos arquivos" : "Enviar"}
        >
          <SendHorizontal size={20} />
        </button>
      </div>
      {picker?.kind === "emoji" && (
        <EmojiPicker
          anchor={picker.anchor}
          onClose={closePicker}
          onPick={(emoji) => {
            closePicker();
            rememberEmoji(emoji);
            insertAtCursor(emoji);
          }}
        />
      )}
      {picker?.kind === "gif" && <GifPicker anchor={picker.anchor} onClose={closePicker} onPick={(g) => void sendGif(g)} />}
    </div>
  );
}
