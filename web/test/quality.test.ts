import { describe, expect, it } from "vitest";
import { linkSnapshot, parsePing, qualityInfo } from "../src/voice/quality.ts";

describe("ping que chega pela sala", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("aceita só um número razoável de ms (arredondado)", () => {
    expect(parsePing(bytes('{"ms":42.6}'))).toBe(43);
    expect(parsePing(bytes('{"ms":0}'))).toBeNull();
    expect(parsePing(bytes('{"ms":99999}'))).toBeNull();
    expect(parsePing(bytes('{"ms":"42"}'))).toBeNull();
    expect(parsePing(bytes("lixo"))).toBeNull();
  });
});

describe("resumo da conexão para o relatório de sinal ruim", () => {
  const stats = (sent: number, lostUp: number, received: number, lostDown: number, bytes: number, local: Record<string, string> = { candidateType: "srflx", protocol: "udp" }) => [
    { type: "transport", id: "T", selectedCandidatePairId: "P" },
    { type: "candidate-pair", id: "P", localCandidateId: "L", currentRoundTripTime: 0.019, bytesSent: bytes },
    { type: "local-candidate", id: "L", ...local },
    { type: "outbound-rtp", id: "O", packetsSent: sent },
    { type: "remote-inbound-rtp", id: "R", packetsLost: lostUp, jitter: 0.004 },
    { type: "inbound-rtp", id: "I", packetsReceived: received, packetsLost: lostDown, jitter: 0.03 },
  ];

  it("calcula perda e envio só do intervalo desde a última leitura", () => {
    const first = linkSnapshot(stats(1000, 0, 2000, 0, 1_000_000), null, 5);
    const s = linkSnapshot(stats(1250, 0, 2190, 10, 1_625_000), first.totals, 5);
    expect(s).toMatchObject({ path: "UDP direto", rttMs: 19, upLossPct: 0, downLossPct: 5, downJitterMs: 30, upKbps: 1000 });
  });

  it("diz quando a voz passa por TURN ou TCP, que costumam piorar a nota", () => {
    expect(linkSnapshot(stats(1, 0, 1, 0, 0, { candidateType: "relay", protocol: "udp", relayProtocol: "tcp" }), null, 5).path).toBe("TURN (tcp)");
    expect(linkSnapshot(stats(1, 0, 1, 0, 0, { candidateType: "host", protocol: "tcp" }), null, 5).path).toBe("TCP direto");
    expect(linkSnapshot([], null, 5).path).toBe("desconhecido");
  });
});

describe("qualidade da conexão", () => {
  it("mapeia os níveis do LiveKit para barras e cores", () => {
    expect(qualityInfo("excellent")).toMatchObject({ bars: 3, tone: "good" });
    expect(qualityInfo("good")).toMatchObject({ bars: 2, tone: "fair" });
    expect(qualityInfo("poor")).toMatchObject({ bars: 1, tone: "bad" });
    expect(qualityInfo("lost")).toMatchObject({ bars: 0, tone: "bad" });
    expect(qualityInfo(undefined)).toMatchObject({ bars: 0, tone: "none" });
  });
});
