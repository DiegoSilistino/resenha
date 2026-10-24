import { useCallback, useState } from "react";
import { SmilePlus } from "lucide-react";
import type { Message } from "@resenha/shared";
import { api } from "../lib/api.ts";
import { displayNameOf, useApp } from "../state/app.ts";
import { rememberEmoji } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { EmojiPicker } from "./EmojiPicker.tsx";

/** "Ana", "Ana e Bia", "Ana, Bia e mais 3". */
export function whoReacted(names: string[]): string {
  if (names.length <= 2) return names.join(" e ");
  if (names.length === 3) return `${names[0]}, ${names[1]} e ${names[2]}`;
  return `${names[0]}, ${names[1]} e mais ${names.length - 2}`;
}

/** Liga/desliga a reação já mostrando na tela; a versão do servidor chega logo depois e prevalece. */
export async function toggleReaction(message: Message, emoji: string) {
  const s = useApp.getState();
  if (!s.me) return;
  const meId = s.me.id;
  const mine = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId) ?? false;
  s.applyLocalReaction(message, emoji, meId, !mine);
  if (!mine) rememberEmoji(emoji);
  try {
    await api.react(message.id, emoji, !mine);
  } catch (err) {
    useApp.getState().applyLocalReaction(message, emoji, meId, mine); // desfaz
    toast.fromError(err);
  }
}

export function ReactionBar({ message }: { message: Message }) {
  const meId = useApp((s) => (s.me ? s.me.id : null));
  const users = useApp((s) => s.users);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  if (message.reactions.length === 0) return null;

  return (
    <div className="reactions">
      {message.reactions.map((r) => {
        const mine = !!meId && r.userIds.includes(meId);
        const names = r.userIds.map((id) => (id === meId ? "você" : displayNameOf(users, id)));
        const label = `${whoReacted(names)} ${r.userIds.length === 1 && !mine ? "reagiu" : "reagiram"} com ${r.emoji}`;
        return (
          <button
            key={r.emoji}
            type="button"
            className="reaction"
            data-mine={mine || undefined}
            aria-pressed={mine}
            title={label}
            aria-label={label}
            onClick={() => void toggleReaction(message, r.emoji)}
          >
            <span className="reaction-emoji">{r.emoji}</span>
            <span className="reaction-count">{r.userIds.length}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="reaction reaction-add"
        aria-label="Adicionar reação"
        title="Adicionar reação"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <SmilePlus size={16} />
      </button>
      {anchor && (
        <EmojiPicker
          anchor={anchor}
          onClose={close}
          onPick={(emoji) => {
            close();
            void toggleReaction(message, emoji);
          }}
        />
      )}
    </div>
  );
}
