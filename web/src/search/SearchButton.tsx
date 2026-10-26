import { Search } from "lucide-react";
import { useUi } from "../state/ui.ts";

/** Lupa do cabeçalho: abre (ou fecha) a busca de mensagens. */
export function SearchButton() {
  const open = useUi((s) => s.searchOpen);
  return (
    <button
      type="button"
      className="icon-btn header-action"
      aria-pressed={open}
      aria-label={open ? "Fechar a busca" : "Buscar mensagens"}
      title={open ? "Fechar a busca" : "Buscar mensagens"}
      onClick={() => useUi.getState().setSearchOpen(!open)}
    >
      <Search size={20} />
    </button>
  );
}
