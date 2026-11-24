import { useEffect, useRef, useState, type DragEvent } from "react";
import type { Channel } from "@resenha/shared";
import { api } from "../lib/api.ts";
import { useApp, useChannelPerm, windowFocused } from "../state/app.ts";
import { Composer, type ComposerHandle } from "./Composer.tsx";
import { MessageList } from "./MessageList.tsx";
import { TypingIndicator } from "./TypingIndicator.tsx";

/** A conversa de um canal (texto ou chat do canal de voz): mensagens, caixa de texto e arrastar arquivos. */
export function ChatPanel({ channel }: { channel: Channel }) {
  const composer = useRef<ComposerHandle>(null);
  const [dragging, setDragging] = useState(false);

  // Enquanto a conversa está aberta, mensagens novas dela não contam como não lidas.
  useEffect(() => {
    useApp.getState().setActiveChannel(channel.id);
    return () => {
      if (useApp.getState().activeChannelId === channel.id) useApp.getState().setActiveChannel(null);
    };
  }, [channel.id]);

  // Conversa privada: avisa o servidor até onde você leu (é o "Visto" dos outros e as não lidas do
  // próximo acesso). Só com a janela em uso; ao voltar para ela, marca o que chegou.
  const lastId = useApp((s) => s.messages[channel.id]?.items.at(-1)?.id ?? 0);
  const myRead = useApp((s) => (s.me ? (s.conversations[channel.id]?.reads[s.me.id] ?? 0) : 0));
  const awayUnread = useApp((s) => s.awayUnread);
  useEffect(() => {
    if (!channel.conversation || lastId <= myRead || !windowFocused()) return;
    api.markConversationRead(channel.id, lastId).catch(() => undefined);
  }, [channel.id, channel.conversation, lastId, myRead, awayUnread]);

  const canSend = useChannelPerm(channel.id, "enviar");
  const canAttach = useChannelPerm(channel.id, "anexar");
  const hasFiles = (e: DragEvent) => canAttach && e.dataTransfer.types.includes("Files");
  const where = channel.kind === "voice" ? `no chat de ${channel.name}` : `em #${channel.name}`;

  return (
    <div
      className="chat-panel"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        composer.current?.addFiles([...e.dataTransfer.files]);
      }}
    >
      <MessageList channel={channel} />
      <div className="chat-bottom">
        {canSend ? (
          <Composer ref={composer} channel={channel} canAttach={canAttach} />
        ) : (
          <p className="composer-blocked">Seu cargo nesta roda não manda mensagens aqui.</p>
        )}
        <TypingIndicator channelId={channel.id} />
      </div>
      {dragging && <div className="drop-hint">Solte para anexar {where}</div>}
    </div>
  );
}
