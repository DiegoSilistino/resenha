import type { ReactNode } from "react";
import { splitMention } from "./mentions.ts";

/**
 * Formatação leve estilo Discord, gerando elementos React (nunca HTML cru, então
 * não há como injetar script): **negrito**, *itálico* ou _itálico_, ~~riscado~~,
 * `código`, blocos ```código```, links automáticos e @menções.
 */
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|((?<![\p{L}\p{N}_])_(?![\s_])[^_\n]+?(?<![\s_])_(?![\p{L}\p{N}_]))|(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|(@[a-z0-9._-]+)/giu;

export function renderMessage(text: string, isKnownUser: (username: string) => boolean): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/```(?:[a-z0-9]*\n)?([\s\S]*?)```/gi);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        <pre key={`b${i}`} className="md-pre">
          <code>{part.replace(/\n$/, "")}</code>
        </pre>,
      );
    } else if (part) {
      out.push(...renderInline(part, isKnownUser, `p${i}`));
    }
  });
  return out;
}

function renderInline(text: string, isKnownUser: (u: string) => boolean, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const token = m[0];
    const key = `${keyPrefix}-${k++}`;
    if (m[1]) nodes.push(<code key={key} className="md-code">{token.slice(1, -1)}</code>);
    else if (m[2]) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (m[3]) nodes.push(<s key={key}>{token.slice(2, -2)}</s>);
    else if (m[4] || m[5]) nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    else if (m[6]) {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noreferrer noopener">
          {token}
        </a>,
      );
    } else if (m[7]) {
      const split = splitMention(token, isKnownUser);
      if (split) {
        nodes.push(
          <span key={key} className="mention">
            {split.mention}
          </span>,
        );
        if (split.rest) nodes.push(split.rest);
      } else nodes.push(token);
    } else nodes.push(token);
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Links do YouTube citados na mensagem (para o botão "pôr no Assistir juntos"). */
export function youTubeLinks(text: string): string[] {
  const links = text.match(/https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s<]+/gi) ?? [];
  return [...new Set(links)].slice(0, 3);
}
