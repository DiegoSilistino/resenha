import { useEffect, useRef, useState } from "react";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { gateConfig, micOptions, useVoice } from "../voice/controller.ts";
import { currentMicLevel, startMicTest } from "../voice/gate/processor.ts";

/** Faixa do medidor, em dBFS. */
const MIN_DB = -80;
const MAX_DB = 0;
const pct = (db: number) => `${Math.round(((Math.min(MAX_DB, Math.max(MIN_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB)) * 100)}%`;

/**
 * Medidor ao vivo: barra do volume, marca do limiar e se o som está passando.
 * Lê o nível a cada quadro direto no DOM (sem re-render do React 60 vezes por segundo).
 */
function Meter() {
  const fill = useRef<HTMLSpanElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lvl = currentMicLevel();
      if (fill.current && mark.current && label.current) {
        fill.current.style.width = lvl ? pct(lvl.level) : "0%";
        fill.current.dataset.open = lvl?.open ? "true" : "false";
        mark.current.style.left = pct(lvl ? lvl.threshold : useSettings.getState().micGateDb);
        label.current.textContent = !lvl ? "Sem leitura do microfone" : lvl.open ? "Transmitindo" : "Silêncio (cortado)";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="mic-meter-wrap">
      <div className="mic-meter" aria-hidden="true">
        <span ref={fill} className="mic-meter-fill" />
        <span ref={mark} className="mic-meter-mark" />
      </div>
      <span ref={label} className="mic-meter-label" aria-live="off" />
    </div>
  );
}

export function MicSensitivity() {
  const s = useSettings();
  const inCall = useVoice((v) => v.status === "connected");
  const [testing, setTesting] = useState(false);
  const test = useRef<Awaited<ReturnType<typeof startMicTest>> | null>(null);

  // Encerra o teste ao fechar as configurações ou ao entrar numa chamada (aí o medidor usa a chamada).
  useEffect(() => {
    if (!testing || inCall) return;
    let cancelled = false;
    const { deviceId, echoCancellation, noiseSuppression, autoGainControl } = micOptions() as MediaTrackConstraints;
    startMicTest({ deviceId, echoCancellation, noiseSuppression, autoGainControl }, gateConfig())
      .then((t) => {
        if (cancelled) t.stop();
        else test.current = t;
      })
      .catch(() => {
        setTesting(false);
        toast.error("Não consegui abrir o microfone. Libere o acesso no cadeado ao lado do endereço do site.");
      });
    return () => {
      cancelled = true;
      test.current?.stop();
      test.current = null;
    };
  }, [testing, inCall, s.micDeviceId, s.noiseSuppression, s.echoCancellation]);

  useEffect(() => {
    test.current?.reconfigure(gateConfig());
  }, [s.micGate, s.micGateAuto, s.micGateDb, s.pttEnabled]);

  const showMeter = inCall || testing;

  return (
    <fieldset className="field sensitivity">
      <legend>Sensibilidade do microfone</legend>
      <label className="check">
        <input type="checkbox" checked={s.micGate} onChange={(e) => s.set({ micGate: e.target.checked })} />
        <span>
          Só transmitir quando eu estiver falando
          <small>Corta teclado, mouse e barulho de fundo nos intervalos entre as falas.</small>
        </span>
      </label>
      {s.micGate && s.pttEnabled && (
        <p className="muted small-note">Com o push-to-talk ligado, a tecla decide quando o microfone abre.</p>
      )}
      {s.micGate && !s.pttEnabled && (
        <>
          <label className="check">
            <input type="checkbox" checked={s.micGateAuto} onChange={(e) => s.set({ micGateAuto: e.target.checked })} />
            <span>
              Ajustar automaticamente
              <small>Acompanha o ruído do seu ambiente. Desmarque para escolher o nível na mão.</small>
            </span>
          </label>
          {!s.micGateAuto && (
            <label className="field">
              <span>Nível mínimo para transmitir: {s.micGateDb} dB</span>
              <input
                type="range"
                min={-80}
                max={-10}
                step={1}
                value={s.micGateDb}
                onChange={(e) => s.set({ micGateDb: Number(e.target.value) })}
              />
              <small>Fale normalmente: a barra deve passar da marca branca. Se o teclado também passa, suba o nível.</small>
            </label>
          )}
          {showMeter ? (
            <Meter />
          ) : (
            <div>
              <button type="button" className="btn btn-small" onClick={() => setTesting(true)}>
                Testar microfone
              </button>
            </div>
          )}
          {testing && !inCall && (
            <div>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setTesting(false)}>
                Parar teste
              </button>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
