import { qualityInfo } from "./quality.ts";

/** Três barrinhas de sinal, coloridas pela qualidade (com texto para leitor de tela). */
/** Barrinhas da conexão; com `ping`, o tooltip mostra também os ms ("Conexão ótima · 42 ms"). */
export function SignalIcon({ quality, ping, size = 14 }: { quality: string | undefined; ping?: number; size?: number }) {
  const info = qualityInfo(quality);
  const label = ping ? `${info.label} · ${ping} ms` : info.label;
  return (
    <span className="signal" data-tone={info.tone} title={label} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1 + i * 4} y={8 - i * 3} width="2.6" height={3 + i * 3} rx="0.8" data-on={i < info.bars || undefined} />
        ))}
      </svg>
    </span>
  );
}
