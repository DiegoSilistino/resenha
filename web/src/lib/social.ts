import type { NavigateFunction } from "react-router";
import type { Conversation } from "@resenha/shared";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { joinVoice } from "../voice/controller.ts";
import { api } from "./api.ts";

/** Abre (ou cria) a conversa com essas pessoas e vai até ela. 1 pessoa sem nome = conversa a dois. */
export async function openConversationWith(
  userIds: string[],
  navigate: NavigateFunction,
  name?: string,
): Promise<Conversation | null> {
  try {
    const { conversation } = await api.openConversation(userIds, name);
    // o evento também chega pelo tempo real; aplicar já evita a tela piscar "não encontrada"
    useApp.getState().applyEvent({ type: "conversation.upsert", conversation });
    void navigate(`/conversas/${conversation.id}`);
    return conversation;
  } catch (err) {
    toast.fromError(err);
    return null;
  }
}

/** "Ligar": abre a conversa a dois e entra na chamada dela. */
export async function callFriend(userId: string, navigate: NavigateFunction): Promise<void> {
  const c = await openConversationWith([userId], navigate);
  if (c) await joinVoice(c.id);
}
