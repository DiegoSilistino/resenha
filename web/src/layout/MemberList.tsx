import { Volume2 } from "lucide-react";
import type { PublicUser } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { useApp } from "../state/app.ts";

export function MemberList() {
  const users = useApp((s) => s.users);
  const online = useApp((s) => s.online);
  const voice = useApp((s) => s.voice);

  const inVoice = new Set(Object.values(voice).flatMap((members) => members.map((m) => m.userId)));
  const active = Object.values(users)
    .filter((u) => !u.disabled)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
  const on = active.filter((u) => online[u.id]);
  const off = active.filter((u) => !online[u.id]);

  return (
    <aside className="members" aria-label="Membros">
      <Group title={`Online, ${on.length}`} users={on} online inVoice={inVoice} />
      {off.length > 0 && <Group title={`Offline, ${off.length}`} users={off} online={false} inVoice={inVoice} />}
    </aside>
  );
}

function Group({
  title,
  users,
  online,
  inVoice,
}: {
  title: string;
  users: PublicUser[];
  online: boolean;
  inVoice: Set<string>;
}) {
  return (
    <section>
      <h2 className="group-title">{title}</h2>
      <ul className="member-list">
        {users.map((u) => (
          <li key={u.id} className="member" data-offline={!online || undefined}>
            <Avatar user={u} size={30} online={online} />
            <span className="member-name">{u.displayName}</span>
            {u.role === "admin" && <span className="role-tag">admin</span>}
            {inVoice.has(u.id) && <Volume2 size={14} className="member-voice" aria-label="em um canal de voz" />}
          </li>
        ))}
      </ul>
    </section>
  );
}
