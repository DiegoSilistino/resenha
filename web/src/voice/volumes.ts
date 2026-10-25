/**
 * Volume que cada fonte de áudio de uma pessoa recebe, de 0 a 2 (200%).
 * Voz e som da tela são independentes: dá para ouvir bem o amigo e baixar o jogo dele.
 */
export interface VolumeInput {
  deafened: boolean;
  /** Volume escolhido para a voz (padrão 1). */
  voice: number | undefined;
  /** Volume escolhido para o som da tela (padrão 1). */
  stream: number | undefined;
  /** Som da tela silenciado nesta sessão (o volume escolhido volta ao reativar). */
  streamMuted: boolean;
}

const clamp = (v: number) => Math.min(2, Math.max(0, v));

export function participantVolumes(i: VolumeInput): { voice: number; stream: number } {
  if (i.deafened) return { voice: 0, stream: 0 };
  return {
    voice: clamp(i.voice ?? 1),
    stream: i.streamMuted ? 0 : clamp(i.stream ?? 1),
  };
}
