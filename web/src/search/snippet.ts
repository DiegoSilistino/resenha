/** Marcadores que o servidor põe em volta dos termos encontrados (não aparecem em texto digitado). */
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";

export interface SnippetPart {
  text: string;
  hit: boolean;
}

/** "oi \u0001bolo\u0002 bom" -> [{oi }, {bolo, hit}, { bom}]. Marcador solto vira texto normal. */
export function parseSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let rest = snippet;
  while (rest) {
    const start = rest.indexOf(MARK_START);
    if (start === -1) break;
    const end = rest.indexOf(MARK_END, start + 1);
    if (end === -1) break;
    if (start > 0) parts.push({ text: rest.slice(0, start), hit: false });
    const hit = rest.slice(start + 1, end);
    if (hit) parts.push({ text: hit, hit: true });
    rest = rest.slice(end + 1);
  }
  const tail = rest.replaceAll(MARK_START, "").replaceAll(MARK_END, "");
  if (tail) parts.push({ text: tail, hit: false });
  // junta pedaços vizinhos do mesmo tipo (fica mais limpo no DOM)
  return parts.reduce<SnippetPart[]>((acc, p) => {
    const last = acc.at(-1);
    if (last && last.hit === p.hit) last.text += p.text;
    else acc.push({ ...p });
    return acc;
  }, []);
}

/** Canal atual a partir do endereço (/c/:id). */
export function channelIdFromPath(path: string): string | null {
  return /^\/(?:c|conversas)\/([^/]+)/.exec(path)?.[1] ?? null;
}
