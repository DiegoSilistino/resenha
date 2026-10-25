export type Role = "admin" | "member";
export type ChannelKind = "text" | "voice";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  role: Role;
  /** Contas desativadas continuam na lista para exibir o autor de mensagens antigas. */
  disabled: boolean;
  /** Foto de perfil (URL relativa); null = iniciais sobre a cor do avatar. */
  avatarUrl: string | null;
}

export type Me = PublicUser;

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  position: number;
}

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  /** URL relativa para baixar ou exibir o arquivo. */
  url: string;
  /** true quando o arquivo é imagem ou vídeo verificado e pode ser exibido inline. */
  inline: boolean;
}

export interface Message {
  id: number;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: number;
  editedAt: number | null;
  attachments: Attachment[];
  /** Em ordem de chegada do primeiro de cada emoji. */
  reactions: Reaction[];
  /** Mensagem que esta responde (com um resumo para a citação). */
  replyTo: MessageReference | null;
}

export interface MessageReference {
  id: number;
  /** true se a original foi apagada (aí não há autor nem texto). */
  deleted: boolean;
  authorId: string | null;
  /** Começo do texto original (até 200 caracteres). */
  content: string;
  attachmentCount: number;
}

/** Um GIF para escolher e mandar. */
export interface GifResult {
  id: string;
  title: string;
  /** Prévia pequena e leve para a grade do seletor. */
  previewUrl: string;
  /** Vídeo MP4 em loop, que é o que vai na mensagem (bem menor que o .gif). */
  mp4Url: string;
  width: number;
  height: number;
}

export interface Reaction {
  emoji: string;
  /** Quem reagiu, na ordem em que reagiu. */
  userIds: string[];
}

export interface VoiceMember {
  userId: string;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
  video: boolean;
  joinedAt: number;
}

export interface WatchItem {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
  addedAt: number;
}

/**
 * Estado sincronizado do "Assistir juntos" de um canal de voz.
 *
 * A posição nunca é transmitida como "tempo atual": ela é derivada do relógio
 * do servidor. Tocando: posição = (agora - startedAt) / 1000. Pausado: pausedPosition.
 * Assim, qualquer cliente que entre no meio calcula exatamente onde o vídeo está.
 */
export interface WatchState {
  channelId: string;
  /**
   * Identifica a "sessão" atual: nasce quando o primeiro vídeo começa e some quando
   * a fila acaba ou alguém encerra. Quem escondeu o player para si esconde ESTA sessão;
   * a próxima reaparece para todo mundo.
   */
  sessionId: string | null;
  current: WatchItem | null;
  queue: WatchItem[];
  playing: boolean;
  /** Epoch (ms, relógio do servidor) em que a posição 0 teria ocorrido. */
  startedAt: number;
  /** Posição em segundos enquanto pausado. */
  pausedPosition: number;
  version: number;
}

export interface Invite {
  code: string;
  role: Role;
  maxUses: number;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
  createdBy: string;
  revoked: boolean;
}

export interface BackupSnapshot {
  name: string;
  size: number;
  createdAt: number;
}

export interface BackupInfo {
  /** Última vez que um administrador baixou o backup completo. */
  lastDownloadAt: number | null;
  /** Cópias diárias do banco guardadas no próprio servidor. */
  snapshots: BackupSnapshot[];
  /** Tamanho aproximado do backup completo, em bytes. */
  totalBytes: number;
  disk: { free: number; total: number } | null;
}
