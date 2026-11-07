/**
 * Maior quadrado que deixa todos cabendo na área: com pouca gente os quadros ficam
 * grandes; conforme entra mais gente, diminuem. Devolve as colunas e a largura de cada um.
 */
export function fitGrid(
  count: number,
  width: number,
  height: number,
  gap: number,
  aspect: number,
): { cols: number; tileWidth: number } {
  let best = { cols: 1, tileWidth: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const w = Math.min((width - gap * (cols - 1)) / cols, ((height - gap * (rows - 1)) / rows) * aspect);
    if (Math.floor(w) > best.tileWidth) best = { cols, tileWidth: Math.floor(w) };
  }
  return best;
}
