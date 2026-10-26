import { useEffect } from "react";
import { Hash, Menu } from "lucide-react";
import type { Channel } from "@resenha/shared";
import { SearchButton } from "../search/SearchButton.tsx";
import { useUi } from "../state/ui.ts";
import { ChatPanel } from "./ChatPanel.tsx";

export function ChatView({ channel }: { channel: Channel }) {
  useEffect(() => {
    useUi.getState().setPageTitle(`#${channel.name}`);
  }, [channel.name]);

  return (
    <main className="main chat">
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
        <div className="header-actions">
          <SearchButton />
        </div>
      </header>
      <ChatPanel channel={channel} />
    </main>
  );
}
