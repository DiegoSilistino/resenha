import { Link } from "react-router";
import { ChevronLeft } from "lucide-react";

/** No celular não há painel ao lado: este "‹" volta para a lista (a roda ou as conversas). */
export function BackToRoda({ to = "/roda", label = "Voltar para a roda" }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="icon-btn icon-btn-round back-to-roda" aria-label={label} title={label}>
      <ChevronLeft size={20} />
    </Link>
  );
}
