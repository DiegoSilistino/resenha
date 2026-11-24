import { useEffect } from "react";
import type { Channel } from "@resenha/shared";
import { useApp } from "../state/app.ts";
import { BackToRoda } from "../layout/BackToRoda.tsx";
import { SearchButton } from "../search/SearchButton.tsx";
import { useUi } from "../state/ui.ts";
import { ChatPanel } from "./ChatPanel.tsx";

export function ChatView({ channel }: { channel: Channel }) {
  const rodaName = useApp((s) => (channel.rodaId ? s.rodas[channel.rodaId]?.name : undefined)) ?? "";
  useEffect(() => {
    useUi.getState().setPageTitle(`#${channel.name}`);
  }, [channel.name]);

  return (
    <main className="main chat">
      <header className="main-header">
        <BackToRoda to={channel.rodaId ? `/r/${channel.rodaId}` : "/rodas"} />
        <div className="main-titles">
          <h1 className="main-title"># {channel.name}</h1>
          <span className="main-sub">{rodaName}</span>
        </div>
        <div className="header-actions">
          <SearchButton />
        </div>
      </header>
      <ChatPanel channel={channel} />
    </main>
  );
}
