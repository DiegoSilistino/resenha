import { Volume2 } from "lucide-react";
import { Avatar } from "../components/Avatar.tsx";
import { Nick } from "../components/Nick.tsx";
import { bannerImageStyle, lookOf } from "../lib/look.ts";
import { useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";

/** "Quem está aqui" na página da roda: por cargo (na ordem dos cargos), online antes de quem está fora. */
export function MemberList({ rodaId }: { rodaId: string }) {
  const roda = useApp((s) => s.rodas[rodaId]);
  const users = useApp((s) => s.users);
  const online = useApp((s) => s.online);
  const voice = useApp((s) => s.voice);
  if (!roda) return null;

  const inVoice = new Set(Object.values(voice).flatMap((members) => members.map((m) => m.userId)));
  const groups = roda.roles
    .map((role) => ({
      role,
      people: Object.entries(roda.members)
        .filter(([uid, rid]) => rid === role.id && users[uid] && !users[uid].removed)
        .map(([uid]) => users[uid]!)
        .sort((a, b) => Number(!!online[b.id]) - Number(!!online[a.id]) || a.displayName.localeCompare(b.displayName, "pt-BR")),
    }))
    .filter((g) => g.people.length > 0);

  return (
    <aside className="members card" aria-labelledby="members-title">
      <h2 id="members-title" className="card-title">
        Quem está aqui
      </h2>
      {groups.map(({ role, people }) => (
        <section key={role.id}>
          <h3 className="mono-label" style={{ color: role.color }}>
            {role.name} · {people.length}
          </h3>
          <ul className="member-list">
            {people.map((u) => {
              // a capa do perfil (imagem ou GIF) aparece no fundo da linha, sem precisar abrir o cartão
              const look = lookOf(u);
              const banner = look.banner === "imagem" ? u.bannerUrl : null;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className="member"
                    data-offline={!online[u.id] || undefined}
                    data-banner={banner ? true : undefined}
                    onClick={() => useUi.getState().openProfile(u.id)}
                  >
                    {banner && <img className="member-banner" src={banner} alt="" style={bannerImageStyle(look)} />}
                    <Avatar user={u} size={32} online={!!online[u.id]} />
                    <span className="member-names">
                      <Nick user={u} className="member-name" />
                      {online[u.id] && u.activity && <span className="member-activity">{u.activity}</span>}
                    </span>
                    {inVoice.has(u.id) && <Volume2 size={14} className="member-voice" aria-label="em uma chamada" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </aside>
  );
}
