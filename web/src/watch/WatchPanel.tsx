import { useState, type FormEvent } from "react";
import { ListX, Plus, Trash2 } from "lucide-react";
import { parseYouTubeVideoId, youTubeThumbnailUrl, type WatchState } from "@resenha/shared";
import { realtime } from "../lib/realtime.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";

/** Adicionar vídeos e gerenciar a fila do canal. O player em si é o WatchDock. */
export function WatchPanel({ channelId, state }: { channelId: string; state: WatchState | undefined }) {
  const [url, setUrl] = useState("");
  const users = useApp((s) => s.users);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!parseYouTubeVideoId(url)) {
      toast.error("Cole um link de vídeo do YouTube (youtube.com/watch?v=… ou youtu.be/…).");
      return;
    }
    realtime.send({ type: "watch", channelId, action: { kind: "add", url } });
    setUrl("");
  }

  const queue = state?.queue ?? [];

  return (
    <aside className="watch-panel" aria-label="Fila do Assistir juntos">
      <form className="watch-add" onSubmit={submit}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Cole um link do YouTube"
          aria-label="Link do YouTube"
          inputMode="url"
        />
        <button className="btn btn-primary btn-small" aria-label="Adicionar à fila">
          <Plus size={16} aria-hidden="true" /> Adicionar
        </button>
      </form>

      {!state?.current && (
        <p className="watch-empty">
          Música ou vídeo, todo mundo ouve e vê no mesmo segundo. Quem estiver no canal pode pausar, pular e
          adiantar.
        </p>
      )}

      {queue.length > 0 && (
        <>
          <div className="watch-queue-head">
            <h3>A seguir</h3>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => {
                if (confirm("Limpar a fila e parar o vídeo atual?")) {
                  realtime.send({ type: "watch", channelId, action: { kind: "clear" } });
                }
              }}
            >
              <ListX size={14} aria-hidden="true" /> Limpar
            </button>
          </div>
          <ol className="watch-queue">
            {queue.map((item) => (
              <li key={item.id} className="watch-item">
                <img src={youTubeThumbnailUrl(item.videoId)} alt="" loading="lazy" />
                <div className="watch-item-text">
                  <span className="watch-item-title" title={item.title}>
                    {item.title}
                  </span>
                  <span className="watch-item-by">por {users[item.addedBy]?.displayName ?? "alguém"}</span>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Tirar "${item.title}" da fila`}
                  onClick={() => realtime.send({ type: "watch", channelId, action: { kind: "remove", itemId: item.id } })}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
