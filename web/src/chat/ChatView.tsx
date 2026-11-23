import { useEffect } from "react";
import { APP_NAME, type Channel } from "@resenha/shared";
import { BackToRoda } from "../layout/BackToRoda.tsx";
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
        <BackToRoda />
        <div className="main-titles">
          <h1 className="main-title"># {channel.name}</h1>
          <span className="main-sub">{APP_NAME}</span>
        </div>
        <div className="header-actions">
          <SearchButton />
        </div>
      </header>
      <ChatPanel channel={channel} />
    </main>
  );
}
