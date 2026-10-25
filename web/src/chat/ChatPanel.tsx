import { useEffect, useRef, useState, type DragEvent } from "react";
import type { Channel } from "@resenha/shared";
import { useApp } from "../state/app.ts";
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

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
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
        <Composer ref={composer} channel={channel} />
        <TypingIndicator channelId={channel.id} />
      </div>
      {dragging && <div className="drop-hint">Solte para anexar {where}</div>}
    </div>
  );
}
