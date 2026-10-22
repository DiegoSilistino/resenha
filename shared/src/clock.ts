/**
 * Estima a diferença entre o relógio local e o do servidor (estilo NTP).
 *
 * Para cada ping: t0 = envio local, server = horário do servidor na resposta,
 * t1 = recebimento local. offset ≈ server - (t0 + t1) / 2.
 * Guardamos as amostras com menor ida-e-volta, que têm o menor erro.
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];

  constructor(private readonly maxSamples = 8) {}

  addSample(t0: number, serverTime: number, t1: number): void {
    const rtt = t1 - t0;
    if (!Number.isFinite(rtt) || rtt < 0) return;
    this.samples.push({ rtt, offset: serverTime - (t0 + t1) / 2 });
    this.samples.sort((a, b) => a.rtt - b.rtt);
    this.samples.length = Math.min(this.samples.length, this.maxSamples);
  }

  /** Milissegundos a somar ao relógio local para obter o horário do servidor. */
  get offset(): number {
    // Mediana das 3 melhores amostras: robusta a um pico isolado.
    const best = this.samples.slice(0, 3).map((s) => s.offset).sort((a, b) => a - b);
    return best.length === 0 ? 0 : best[Math.floor(best.length / 2)]!;
  }

  get hasSamples(): boolean {
    return this.samples.length > 0;
  }

  serverNow(localNow: number = Date.now()): number {
    return localNow + this.offset;
  }
}
