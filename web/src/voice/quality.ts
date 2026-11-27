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
      // o ping (ms) pode estar ótimo e mesmo assim perder pacote: o texto diz o que as barrinhas medem
      return { bars: 1, tone: "bad", label: "Conexão instável: pacotes de voz se perdendo, a voz pode picotar" };
    case "lost":
      return { bars: 0, tone: "bad", label: "Conexão perdida, tentando voltar" };
    default:
      return { bars: 0, tone: "none", label: "Medindo a conexão…" };
  }
}

/** Um item de RTCStatsReport (só os campos lidos aqui). */
export interface StatLike {
  type: string;
  id: string;
  [field: string]: unknown;
}

/** Contadores acumulados da última leitura, para calcular o que mudou desde ela. */
export interface LinkTotals {
  sent: number;
  lostUp: number;
  received: number;
  lostDown: number;
  bytesSent: number;
}

export interface LinkSnapshot {
  /** Por onde a voz passa: "UDP direto", "TCP direto" ou "TURN (tcp)"… */
  path: string;
  rttMs: number | null;
  upLossPct: number;
  upJitterMs: number;
  downLossPct: number;
  downJitterMs: number;
  upKbps: number;
  totals: LinkTotals;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pct = (lost: number, total: number) => (total > 0 ? Math.round((Math.max(0, lost) / total) * 1000) / 10 : 0);

/**
 * Resume as estatísticas WebRTC da chamada no intervalo desde `prev`: caminho, perda e variação
 * de atraso no envio (o que o servidor relatou) e no recebimento. É o que o LiveKit usa para a nota.
 */
export function linkSnapshot(stats: StatLike[], prev: LinkTotals | null, seconds: number): LinkSnapshot {
  const byId = new Map(stats.map((s) => [s.id, s]));
  const transport = stats.find((s) => s.type === "transport" && s.selectedCandidatePairId);
  const pair =
    (transport && byId.get(String(transport.selectedCandidatePairId))) ??
    stats.find((s) => s.type === "candidate-pair" && s.nominated && s.state === "succeeded");
  const local = pair ? byId.get(String(pair.localCandidateId)) : undefined;
  const path = !local
    ? "desconhecido"
    : local.candidateType === "relay"
      ? `TURN (${String(local.relayProtocol ?? local.protocol)})`
      : `${String(local.protocol).toUpperCase()} direto`;

  const totals: LinkTotals = { sent: 0, lostUp: 0, received: 0, lostDown: 0, bytesSent: num(pair?.bytesSent) };
  let upJitter = 0;
  let downJitter = 0;
  for (const s of stats) {
    if (s.type === "outbound-rtp") totals.sent += num(s.packetsSent);
    if (s.type === "remote-inbound-rtp") {
      totals.lostUp += num(s.packetsLost);
      upJitter = Math.max(upJitter, num(s.jitter));
    }
    if (s.type === "inbound-rtp") {
      totals.received += num(s.packetsReceived);
      totals.lostDown += num(s.packetsLost);
      downJitter = Math.max(downJitter, num(s.jitter));
    }
  }
  const d = (k: keyof LinkTotals) => totals[k] - (prev?.[k] ?? 0);
  return {
    path,
    rttMs: pair && typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null,
    upLossPct: pct(d("lostUp"), d("sent") + Math.max(0, d("lostUp"))),
    upJitterMs: Math.round(upJitter * 1000),
    downLossPct: pct(d("lostDown"), d("received") + Math.max(0, d("lostDown"))),
    downJitterMs: Math.round(downJitter * 1000),
    upKbps: seconds > 0 ? Math.round((Math.max(0, d("bytesSent")) * 8) / seconds / 1000) : 0,
    totals,
  };
}

/** Ping que outra pessoa mandou pela sala (`{"ms": 42}`): só número razoável, senão null. */
export function parsePing(payload: Uint8Array): number | null {
  try {
    const { ms } = JSON.parse(new TextDecoder().decode(payload)) as { ms?: unknown };
    return typeof ms === "number" && ms > 0 && ms < 10_000 ? Math.round(ms) : null;
  } catch {
    return null;
  }
}
