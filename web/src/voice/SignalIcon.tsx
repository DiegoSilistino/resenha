import { qualityInfo } from "./quality.ts";

/** Três barrinhas de sinal, coloridas pela qualidade (com texto para leitor de tela). */
export function SignalIcon({ quality, size = 14 }: { quality: string | undefined; size?: number }) {
  const info = qualityInfo(quality);
  return (
    <span className="signal" data-tone={info.tone} title={info.label} role="img" aria-label={info.label}>
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1 + i * 4} y={8 - i * 3} width="2.6" height={3 + i * 3} rx="0.8" data-on={i < info.bars || undefined} />
        ))}
      </svg>
    </span>
  );
}
