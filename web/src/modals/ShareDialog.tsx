import { useEffect, useState } from "react";
import { Modal } from "../components/Modal.tsx";
import { desktop, DESKTOP_DOWNLOAD_URL, type ScreenSource } from "../lib/desktop.ts";
import { useSettings } from "../state/settings.ts";
import { useUi } from "../state/ui.ts";
import { startScreenShare } from "../voice/controller.ts";
import { SCREEN_QUALITIES, screenQuality, uploadMbps, type ScreenQualityId } from "../voice/screenQuality.ts";

const mbps = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** No app de computador o próprio Resenha mostra as telas e os apps (no navegador, quem mostra é ele). */
const listSources = desktop?.listScreenSources;

/**
 * Transmitir a tela. No app: primeiro o que mostrar (como no Discord), depois a qualidade.
 * No navegador: a qualidade, e a escolha da tela fica na janela do navegador.
 */
export function ShareDialog() {
  const saved = useSettings((s) => s.screenQuality);
  const savedAudio = useSettings((s) => s.screenAudio);
  const [choice, setChoice] = useState<ScreenQualityId>(() => screenQuality(saved).id);
  const [withAudio, setWithAudio] = useState(savedAudio);
  const [source, setSource] = useState<ScreenSource | null>(null);
  const close = () => useUi.getState().setShareDialogOpen(false);

  // app 1.0.0: o Windows nunca liberava a captura (faltava a permissão display-capture); só atualizando
  if (desktop && !listSources) {
    return (
      <Modal title="Transmitir a tela" onClose={close}>
        <div className="form">
          <p>
            Para transmitir a tela, atualize o app do Resenha. A versão instalada tem um defeito que impede o Windows de
            liberar a captura.
          </p>
          <a className="btn btn-primary" href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            Baixar a versão nova
          </a>
        </div>
      </Modal>
    );
  }

  if (listSources && !source) {
    return (
      <Modal title="Transmitir a tela" onClose={close} wide>
        <SourcePicker list={listSources} onPick={setSource} />
      </Modal>
    );
  }

  return (
    <Modal title="Transmitir a tela" onClose={close}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          // Ainda dentro do clique: o navegador só abre a escolha de tela a partir de um gesto
          // (o aviso ao app leva milissegundos, bem dentro do prazo do gesto).
          void (async () => {
            if (source) await desktop?.chooseScreenSource?.(source.id);
            await startScreenShare(choice, withAudio);
          })();
        }}
      >
        {source && (
          <div className="source-chosen">
            {source.thumbnail && <img src={source.thumbnail} alt="" />}
            <span>{source.name}</span>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setSource(null)}>
              Trocar
            </button>
          </div>
        )}
        <fieldset className="quality-options">
          <legend className="sr-only">Qualidade da transmissão</legend>
          {SCREEN_QUALITIES.map((q) => (
            <label key={q.id} className="quality-option" data-selected={choice === q.id || undefined}>
              <input
                type="radio"
                name="quality"
                value={q.id}
                checked={choice === q.id}
                onChange={() => setChoice(q.id)}
              />
              <span className="quality-text">
                <span className="quality-title">
                  {q.label}
                  <span className="quality-spec">
                    {q.height}p · {q.fps} fps
                  </span>
                </span>
                <span className="quality-hint">{q.hint}</span>
                <span className="quality-upload">Usa até ~{mbps(uploadMbps(q))} Mbps da sua internet (envio)</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} />
          <span>
            Transmitir o som do computador
            <small>
              {!withAudio
                ? "A turma vai ver a tela, sem o som do jogo ou do vídeo."
                : source
                  ? "Vai o som de tudo o que toca no computador, não só do que você escolheu. Se der erro de som, desmarque esta opção."
                  : "Na janela seguinte, deixe marcado \"Compartilhar áudio\". Se der erro de som, desmarque esta opção."}
            </small>
          </span>
        </label>
        <button className="btn btn-primary">{source ? "Transmitir" : "Escolher o que transmitir"}</button>
      </form>
    </Modal>
  );
}

/** Abas de apps e telas com miniaturas ao vivo, como no Discord. */
function SourcePicker({
  list,
  onPick,
}: {
  list: () => Promise<ScreenSource[]>;
  onPick(source: ScreenSource): void;
}) {
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [tab, setTab] = useState<"apps" | "screens">("apps");

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = () =>
      list()
        .catch(() => [])
        .then((found) => {
          if (!alive) return;
          setSources(found);
          timer = window.setTimeout(load, 3_000); // miniaturas se mexendo, como no Discord
        });
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [list]);

  const screens = sources?.filter((s) => s.screen) ?? [];
  // o Windows dá os nomes em inglês ("Screen 1"); aqui viram "Tela inteira" ou "Tela 1", "Tela 2"…
  const named = (sources ?? []).map((s) =>
    s.screen
      ? { ...s, name: screens.length === 1 ? "Tela inteira" : `Tela ${screens.indexOf(s) + 1}` }
      : { ...s, name: s.name || "Sem nome" },
  );
  const shown = named.filter((s) => s.screen === (tab === "screens"));

  return (
    <>
      <div className="tabs" role="tablist" aria-label="O que transmitir">
        <button type="button" role="tab" className="tab" aria-selected={tab === "apps"} onClick={() => setTab("apps")}>
          Aplicativos
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === "screens"}
          onClick={() => setTab("screens")}
        >
          Telas inteiras
        </button>
      </div>
      {sources === null ? (
        <p className="muted">Procurando o que está aberto…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{tab === "apps" ? "Nenhum aplicativo aberto." : "Nenhuma tela encontrada."}</p>
      ) : (
        <div className="source-grid" role="tabpanel">
          {shown.map((s) => (
            <button key={s.id} type="button" className="source-card" onClick={() => onPick(s)}>
              <span className="source-thumb">{s.thumbnail && <img src={s.thumbnail} alt="" />}</span>
              <span className="source-name">
                {s.icon && <img src={s.icon} alt="" />}
                <span>{s.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
