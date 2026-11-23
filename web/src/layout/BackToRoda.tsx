import { Link } from "react-router";
import { ChevronLeft } from "lucide-react";

/** No celular não há painel de salas ao lado: este "‹" volta para a roda, onde ficam as outras salas. */
export function BackToRoda() {
  return (
    <Link to="/roda" className="icon-btn icon-btn-round back-to-roda" aria-label="Voltar para a roda" title="Voltar para a roda">
      <ChevronLeft size={20} />
    </Link>
  );
}
