import { useEffect, useRef, useState, type DragEvent } from "react";
import { Hash, Menu } from "lucide-react";
import type { Channel } from "@resenha/shared";
import { useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";
import { Composer, type ComposerHandle } from "./Composer.tsx";
import { MessageList } from "./MessageList.tsx";
import { TypingIndicator } from "./TypingIndicator.tsx";

export function ChatView({ channel }: { channel: Channel }) {
  const composer = useRef<ComposerHandle>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    useApp.getState().setActiveChannel(channel.id);
    useUi.getState().setPageTitle(`#${channel.name}`);
    return () => useApp.getState().setActiveChannel(null);
  }, [channel.id, channel.name]);

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <main
      className="main chat"
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
      <header className="main-header">
        <button
          type="button"
          className="icon-btn nav-toggle"
          onClick={() => useUi.getState().setNavOpen(true)}
          aria-label="Abrir lista de canais"
        >
          <Menu size={20} />
        </button>
        <Hash size={20} aria-hidden="true" className="header-icon" />
        <h1 className="main-title">{channel.name}</h1>
      </header>
      <MessageList channel={channel} />
      <div className="chat-bottom">
        <Composer ref={composer} channel={channel} />
        <TypingIndicator channelId={channel.id} />
      </div>
      {dragging && <div className="drop-hint">Solte para anexar em #{channel.name}</div>}
    </main>
  );
}
