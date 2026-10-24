import type {
  ApiErrorBody,
  Attachment,
  BackupInfo,
  Channel,
  ChannelKind,
  Invite,
  Me,
  Message,
  PublicUser,
  Role,
  VoiceTokenResponse,
} from "@resenha/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  const isForm = body instanceof FormData;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor. Verifique sua internet.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Erro ${res.status}`, data?.fields ?? {});
  }
  return data as T;
}

export type InviteWithUrl = Invite & { url: string };

export const api = {
  session: () => request<{ me: Me | null }>("GET", "/api/auth/session"),
  login: (username: string, password: string) =>
    request<{ me: Me }>("POST", "/api/auth/login", { username, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  inviteInfo: (code: string) => request<{ role: Role }>("GET", `/api/invites/${encodeURIComponent(code)}`),
  register: (b: { code: string; username: string; displayName: string; password: string }) =>
    request<{ me: Me }>("POST", "/api/auth/register", b),

  updateMe: (b: { displayName?: string; avatarColor?: string }) => request<{ me: Me }>("PATCH", "/api/me", b),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("POST", "/api/me/password", { currentPassword, newPassword }),
  uploadAvatar: (image: Blob) => {
    const form = new FormData();
    form.append("file", image, image.type === "image/webp" ? "avatar.webp" : "avatar.png");
    return request<{ me: Me }>("POST", "/api/me/avatar", form);
  },
  removeAvatar: () => request<{ me: Me }>("DELETE", "/api/me/avatar"),

  messages: (channelId: string, before?: number) =>
    request<{ messages: Message[]; hasMore: boolean }>(
      "GET",
      `/api/channels/${channelId}/messages${before ? `?before=${before}` : ""}`,
    ),
  sendMessage: (channelId: string, content: string, attachmentIds: string[]) =>
    request<{ message: Message }>("POST", `/api/channels/${channelId}/messages`, { content, attachmentIds }),
  editMessage: (id: number, content: string) => request<{ message: Message }>("PATCH", `/api/messages/${id}`, { content }),
  deleteMessage: (id: number) => request<void>("DELETE", `/api/messages/${id}`),
  react: (id: number, emoji: string, on: boolean) =>
    request<void>(on ? "PUT" : "DELETE", `/api/messages/${id}/reactions/${encodeURIComponent(emoji)}`),

  voiceToken: (channelId: string) => request<VoiceTokenResponse>("POST", "/api/voice/token", { channelId }),

  createChannel: (name: string, kind: ChannelKind) => request<{ channel: Channel }>("POST", "/api/channels", { name, kind }),
  updateChannel: (id: string, b: { name?: string; position?: number }) =>
    request<{ channel: Channel }>("PATCH", `/api/channels/${id}`, b),
  deleteChannel: (id: string) => request<void>("DELETE", `/api/channels/${id}`),

  invites: () => request<{ invites: InviteWithUrl[] }>("GET", "/api/admin/invites"),
  createInvite: (b: { role: Role; maxUses: number; expiresInHours: number | null }) =>
    request<{ invite: InviteWithUrl }>("POST", "/api/admin/invites", b),
  revokeInvite: (code: string) => request<void>("DELETE", `/api/admin/invites/${encodeURIComponent(code)}`),
  setUserDisabled: (id: string, disabled: boolean) =>
    request<{ user: PublicUser }>("POST", `/api/admin/users/${id}/${disabled ? "disable" : "enable"}`),
  setUserRole: (id: string, role: Role) => request<{ user: PublicUser }>("PATCH", `/api/admin/users/${id}/role`, { role }),
  backupInfo: () => request<BackupInfo>("GET", "/api/admin/backup/info"),
};

/** O download do backup é uma navegação normal (o navegador mostra o progresso). */
export const BACKUP_DOWNLOAD_URL = "/api/admin/backup";

/**
 * Envio de arquivo com progresso (fetch ainda não informa progresso de upload).
 */
export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as { attachment?: Attachment; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.attachment) resolve(body.attachment);
      else reject(new ApiError(xhr.status, body?.error ?? "Não foi possível enviar o arquivo"));
    };
    xhr.onerror = () => reject(new ApiError(0, "Falha de rede ao enviar o arquivo"));
    xhr.onabort = () => reject(new ApiError(0, "Envio cancelado"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
