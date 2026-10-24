import { useState } from "react";
import { Modal } from "../components/Modal.tsx";
import { useSettings } from "../state/settings.ts";
import { useUi } from "../state/ui.ts";
import { startScreenShare } from "../voice/controller.ts";
import { SCREEN_QUALITIES, screenQuality, uploadMbps, type ScreenQualityId } from "../voice/screenQuality.ts";

const mbps = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Escolha da qualidade antes de abrir a janela de seleção de tela do navegador. */
export function ShareDialog() {
  const saved = useSettings((s) => s.screenQuality);
  const [choice, setChoice] = useState<ScreenQualityId>(() => screenQuality(saved).id);
  const close = () => useUi.getState().setShareDialogOpen(false);

  return (
    <Modal title="Transmitir a tela" onClose={close}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          // Ainda dentro do clique: o navegador só abre a escolha de tela a partir de um gesto.
          void startScreenShare(choice);
        }}
      >
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
        <p className="muted quality-note">
          Na janela seguinte, marque <strong>Compartilhar áudio</strong> para a turma ouvir o som do jogo ou do vídeo.
        </p>
        <button className="btn btn-primary">Escolher o que transmitir</button>
      </form>
    </Modal>
  );
}
