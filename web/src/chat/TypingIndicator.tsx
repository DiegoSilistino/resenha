import { useEffect, useState } from "react";
import { useApp } from "../state/app.ts";

export function TypingIndicator({ channelId }: { channelId: string }) {
  const typing = useApp((s) => s.typing[channelId]);
  const users = useApp((s) => s.users);
  const meId = useApp((s) => (s.me ? s.me.id : null));
  const [now, setNow] = useState(Date.now());

  const hasEntries = !!typing && Object.keys(typing).length > 0;
  useEffect(() => {
    if (!hasEntries) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [hasEntries]);

  const names = Object.entries(typing ?? {})
    .filter(([userId, until]) => until > now && userId !== meId)
    .map(([userId]) => users[userId]?.displayName ?? "Alguém");

  let text = "";
  if (names.length === 1) text = `${names[0]} está digitando…`;
  else if (names.length === 2) text = `${names[0]} e ${names[1]} estão digitando…`;
  else if (names.length > 2) text = "Várias pessoas estão digitando…";

  return (
    <div className="typing" aria-live="polite">
      {text}
    </div>
  );
}
