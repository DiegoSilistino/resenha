import { api } from "./api.ts";
import { realtime } from "./realtime.ts";
import { leaveVoice } from "../voice/controller.ts";
import { useApp } from "../state/app.ts";

/** Sai da conta: encerra voz e tempo real e limpa todo o estado local. */
export async function logout(): Promise<void> {
  await leaveVoice();
  realtime.stop();
  try {
    await api.logout();
  } finally {
    useApp.getState().reset();
  }
}
