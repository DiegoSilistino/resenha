/**
 * Montagem segura da busca. O texto da pessoa nunca vira sintaxe do FTS5: cada palavra
 * vai entre aspas (com prefixo), então "pizz" acha "PIZZA" e nada quebra a consulta.
 */
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";
const MAX_TERMS = 6;

export function searchTerms(text: string): string[] {
  return text
    .normalize("NFC")
    .split(/\s+/)
    .map((t) => t.replace(/["\u0001\u0002]/g, "").trim())
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

/** "bora pizz" -> "bora"* "pizz"* (todas as palavras, cada uma como começo de palavra). */
export function ftsQuery(terms: string[]): string | null {
  return terms.length ? terms.map((t) => `"${t}"*`).join(" ") : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Trecho em volta da primeira palavra encontrada, com as ocorrências marcadas
 * (usado quando o SQLite não tem FTS5; o FTS5 faz o próprio trecho).
 */
export function makeSnippet(content: string, terms: string[], radius = 60): string {
  const folded = fold(content);
  const needles = terms.map(fold).filter(Boolean);
  // a normalização NFD pode mudar o tamanho: só marca quando os índices batem
  const sameLength = folded.length === content.length;
  let first = -1;
  for (const n of needles) {
    const i = folded.indexOf(n);
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  const start = first === -1 ? 0 : Math.max(0, first - radius);
  const end = Math.min(content.length, (first === -1 ? 0 : first) + radius * 2);
  let out = "";
  let i = start;
  while (i < end) {
    const hit = sameLength ? needles.find((n) => n && folded.startsWith(n, i)) : undefined;
    if (hit) {
      out += MARK_START + content.slice(i, i + hit.length) + MARK_END;
      i += hit.length;
    } else {
      out += content[i];
      i++;
    }
  }
  return `${start > 0 ? "…" : ""}${out}${end < content.length ? "…" : ""}`;
}
