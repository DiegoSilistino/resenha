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
  /** Conta removida pelo admin: só aparece como autor "Ex-membro" de mensagens antigas. */
  removed: boolean;
  /** Foto de perfil (URL relativa); null = iniciais sobre a cor do avatar. */
  avatarUrl: string | null;
  /**
   * Status escolhido. "invisivel" vem só para a própria pessoa e quem lê o protocolo cru:
   * para os outros ela simplesmente não aparece online (o servidor esconde a presença).
   */
  status: UserStatus;
  /** "Jogando CS2", "maratonando série"… (vazio = nada). */
  activity: string;
  /** Recado no cartão do perfil. */
  note: string;
  look: ProfileLook;
  /** Imagem ou GIF da capa do perfil (URL relativa); null = capa na cor do perfil. */
  bannerUrl: string | null;
}

export type UserStatus = "online" | "ausente" | "ocupado" | "invisivel";

/** Personalização do perfil: aparece no cartão, nos balões e nas listas. */
export interface ProfileLook {
  /** Cor do perfil (uma de PROFILE_COLORS); null = a cor do avatar. */
  a: string | null;
  /** Segunda cor, usada no degradê do nick e quando twoTone está ligado. */
  b: string | null;
  /** Cartão e molduras em duas cores. */
  twoTone: boolean;
  banner: "cor" | "imagem";
  frame: "nenhuma" | "anel" | "duplo" | "tracejado" | "halo";
  nickStyle: "padrao" | "cor" | "gradiente";
  font: "onest" | "mono" | "larga" | "serif" | "pixel";
}

export type Me = PublicUser;

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  position: number;
  /** Conversa privada (só no app, para o chat saber como se apresentar); salas da roda não têm. */
  conversation?: Conversation["type"];
  /** Roda da sala (conversas privadas não têm). */
  rodaId?: string;
}

/** O que cada cargo pode fazer numa roda. */
export const PERMISSIONS = ["ver", "enviar", "anexar", "voz", "tela", "convidar", "salas", "expulsar"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface RodaRole {
  id: string;
  name: string;
  color: string;
  perms: Permission[];
  position: number;
  /** Dono: pode tudo, não se edita nem se atribui. */
  owner: boolean;
  /** Cargo de quem entra. */
  isDefault: boolean;
}

/** Um grupo de amigos com as salas dele, cargos e quem faz parte. */
export interface Roda {
  id: string;
  name: string;
  description: string;
  /** Matiz da cor da roda (faixa, ícone). */
  hue: number;
  privacy: "privada" | "aberta";
  roles: RodaRole[];
  /** Quem faz parte: pessoa -> cargo. */
  members: Record<string, string>;
  /** Pedidos de entrada esperando aprovação (convite com aprovação). */
  requests: string[];
  createdAt: number;
}

/** Roda aberta em que você ainda não está (para encontrar e entrar). */
export interface RodaSummary {
  id: string;
  name: string;
  description: string;
  hue: number;
  memberCount: number;
}

/**
 * Conversa privada: entre dois amigos ("dm") ou um grupo de até 10 pessoas.
 * Por baixo é um canal de texto com membros; mensagens, anexos e chamada funcionam igual.
 */
export interface Conversation {
  id: string;
  type: "dm" | "group";
  /** Nome do grupo (vazio na conversa a dois: o app mostra o nome da outra pessoa). */
  name: string;
  /** Inclui você. */
  memberIds: string[];
  /** Última mensagem (prévia na lista e ordem das conversas). */
  lastMessage: Message | null;
  /** Até qual mensagem cada membro já leu (o "Visto"). */
  reads: Record<string, number>;
  createdAt: number;
}

/** Amizade do seu ponto de vista: amigo, pedido que chegou ou pedido que você mandou. */
export interface FriendEntry {
  userId: string;
  status: "friend" | "incoming" | "outgoing";
  since: number;
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
  /** Roda em que quem usar o convite entra. */
  rodaId: string | null;
  /** Entrar depende de alguém da roda aprovar. */
  approval: boolean;
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

/** Tipo de falha que o navegador reporta para o painel de erros do admin. */
export type ClientErrorKind = "voz" | "microfone" | "tela" | "ruido" | "inesperado";

export interface ClientErrorEntry {
  id: number;
  userId: string;
  kind: ClientErrorKind;
  message: string;
  /** Detalhe técnico (nome e mensagem do erro original, motivo da desconexão…). */
  detail: string;
  userAgent: string;
  /** Situação no momento (página aberta, estado da voz, redução de ruído…). */
  context: Record<string, string | number | boolean>;
  createdAt: number;
}

export interface SearchResult {
  message: Message;
  /**
   * Trecho com as palavras encontradas entre \u0001 e \u0002 (o cliente transforma em
   * destaque; nunca é HTML).
   */
  snippet: string;
}

export interface SoundboardSound {
  id: string;
  name: string;
  emoji: string;
  uploaderId: string;
  /** URL relativa do áudio. */
  url: string;
  createdAt: number;
}
