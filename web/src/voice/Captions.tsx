import { useEffect, useState } from "react";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { speechSupported } from "./speech.ts";
import { useVoice } from "./controller.ts";

const VISIBLE_MS = 7_000;

/** Faixa de legendas: a última fala de cada pessoa, em texto grande. */
export function Captions() {
  const captions = useVoice((s) => s.captions);
  const users = useApp((s) => s.users);
  const transcribe = useSettings((s) => s.transcribe);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const recent = Object.entries(captions)
    .filter(([, c]) => now - c.at < VISIBLE_MS)
    .sort(([, a], [, b]) => a.at - b.at);

  return (
    <section className="captions" aria-label="Legendas ao vivo" aria-live="polite">
      {recent.length === 0 ? (
        <p className="captions-empty">As falas aparecem aqui quando alguém com transcrição ligada falar.</p>
      ) : (
        recent.map(([identity, c]) => (
          <p key={identity} className="caption-line" data-final={c.final || undefined}>
            <span className="caption-who">{users[identity]?.displayName ?? "Alguém"}</span> {c.text}
          </p>
        ))
      )}
      {!transcribe && speechSupported() && (
        <p className="captions-hint">
          Sua fala não está sendo transcrita.{" "}
          <button type="button" className="link-btn" onClick={() => useSettings.getState().set({ transcribe: true })}>
            Transcrever minha fala
          </button>{" "}
          (o reconhecimento é feito pelo navegador: Google no Chrome, Microsoft no Edge).
        </p>
      )}
    </section>
  );
}
