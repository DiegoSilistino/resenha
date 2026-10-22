import { X } from "lucide-react";
import { useToasts } from "../state/toasts.ts";

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-level={t.level}>
          <span>{t.text}</span>
          <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dispensar aviso">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
