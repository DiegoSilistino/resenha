/**
 * Menções (@usuario). Usuários podem ter ".", "-" e "_" no nome, então "@diego." no fim
 * da frase menciona "diego", mas "@diego.silva" é outra pessoa.
 */
// "-" fica de fora: fora de colchetes ele não é especial, e "\-" é erro com a flag "u".
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentionsUser(content: string, username: string): boolean {
  if (!username) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_.@-])@${escape(username)}(?![\\p{L}\\p{N}_-])(?!\\.[\\p{L}\\p{N}_-])`, "iu");
  return re.test(content);
}

/**
 * Separa a menção da pontuação colada: "@diego." vira "@diego" + ".".
 * Devolve null quando ninguém com esse nome existe.
 */
export function splitMention(token: string, isKnownUser: (username: string) => boolean): { mention: string; rest: string } | null {
  let name = token.slice(1);
  while (name) {
    if (isKnownUser(name.toLowerCase())) return { mention: `@${name}`, rest: token.slice(1 + name.length) };
    if (!/[._-]$/.test(name)) break;
    name = name.slice(0, -1);
  }
  return null;
}
