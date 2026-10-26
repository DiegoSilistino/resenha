/**
 * Qualidade da conexão de cada pessoa na chamada (medida pelo LiveKit: perda de pacotes,
 * atraso e variação). Sem importar o LiveKit: os valores são as strings do enum dele.
 */
export type QualityValue = "excellent" | "good" | "poor" | "lost" | "unknown";

export interface QualityInfo {
  /** Barrinhas acesas, de 0 a 3. */
  bars: 0 | 1 | 2 | 3;
  tone: "good" | "fair" | "bad" | "none";
  label: string;
}

export function qualityInfo(q: string | undefined): QualityInfo {
  switch (q) {
    case "excellent":
      return { bars: 3, tone: "good", label: "Conexão ótima" };
    case "good":
      return { bars: 2, tone: "fair", label: "Conexão boa, com pequenas oscilações" };
    case "poor":
      return { bars: 1, tone: "bad", label: "Conexão ruim: a voz pode picotar" };
    case "lost":
      return { bars: 0, tone: "bad", label: "Conexão perdida, tentando voltar" };
    default:
      return { bars: 0, tone: "none", label: "Medindo a conexão…" };
  }
}
