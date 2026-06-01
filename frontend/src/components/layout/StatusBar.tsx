import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/api/auth";
import { cn } from "@/lib/utils";

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        ok ? "bg-green-500" : "bg-red-500",
      )}
    />
  );
}

export function StatusBar() {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: false,
  });

  const dbOk = data?.checks?.database?.status === "ok";
  const ollamaOk = data?.checks?.ollama?.status === "ok";
  const diskFree = data?.checks?.disk?.free_gb;

  return (
    <footer className="flex h-7 items-center gap-4 border-t bg-muted/40 px-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Dot ok={dbOk} />
        Database
      </span>
      <span className="flex items-center gap-1.5">
        <Dot ok={ollamaOk} />
        Ollama
      </span>
      {diskFree !== undefined && (
        <span className="flex items-center gap-1.5">
          <Dot ok={diskFree >= 1} />
          Disk {diskFree.toFixed(1)} GB free
        </span>
      )}
    </footer>
  );
}
