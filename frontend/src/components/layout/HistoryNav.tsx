import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

import { useNavHistoryStore } from "@/stores/navHistoryStore";
import { isModKey, modLabel } from "@/lib/platform";
import { cn } from "@/lib/utils";

export function HistoryNav() {
  const location = useLocation();
  const navType = useNavigationType();
  const navigate = useNavigate();
  const visit = useNavHistoryStore((s) => s.visit);
  const index = useNavHistoryStore((s) => s.index);
  const depth = useNavHistoryStore((s) => s.keys.length);

  useEffect(() => {
    visit(location.key, navType);
  }, [location.key, navType, visit]);

  const canBack = index > 0;
  const canForward = index >= 0 && index < depth - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Alt+Arrow is also "move by word" in a text field.
      if (target?.isContentEditable) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const back =
        (e.altKey && e.key === "ArrowLeft") || (isModKey(e) && e.key === "[");
      const forward =
        (e.altKey && e.key === "ArrowRight") || (isModKey(e) && e.key === "]");
      if (back && canBack) {
        e.preventDefault();
        navigate(-1);
      } else if (forward && canForward) {
        e.preventDefault();
        navigate(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canBack, canForward, navigate]);

  const style =
    "rounded-md border bg-muted p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-muted disabled:hover:text-muted-foreground";

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => navigate(-1)}
        disabled={!canBack}
        title={`Back (Alt+← or ${modLabel("[")})`}
        aria-label="Back"
        className={cn(style)}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={() => navigate(1)}
        disabled={!canForward}
        title={`Forward (Alt+→ or ${modLabel("]")})`}
        aria-label="Forward"
        className={cn(style)}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
