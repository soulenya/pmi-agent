import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Plug, PlugZap } from "lucide-react";

import {
  connectErp,
  disconnectOdoo,
  getErpProviders,
  getOdooStatus,
  type ErpProviderInfo,
} from "@/api/odoo";
import { useAuthStore } from "@/stores/authStore";

/** "<local part of the signed-in user>@<domain>" when the provider supplies a domain. */
function loginFor(email: string | undefined, domain: string): string {
  const local = (email ?? "").split("@")[0];
  return local && domain ? `${local}@${domain}` : "";
}

function initialValues(p: ErpProviderInfo, email: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of p.fields) out[f.name] = p.defaults[f.name] ?? "";
  if ("username" in out && !out.username) out.username = loginFor(email, p.defaults.email_domain ?? "");
  return out;
}

export interface ErpConnectPanelProps {
  /** Called after a successful connect or disconnect. */
  onChanged?: () => void;
  compact?: boolean;
}

/**
 * Pick a provider (when the build offers a choice) and connect it. Shown on
 * the ERP page when nothing is connected, and as the ERP step of Company
 * Setup. The connection is per user; the secret is encrypted at rest.
 */
export function ErpConnectPanel({ onChanged, compact = false }: ErpConnectPanelProps) {
  const qc = useQueryClient();
  const userEmail = useAuthStore((s) => s.user?.email);
  const { data: providers } = useQuery({ queryKey: ["erp-providers"], queryFn: getErpProviders });
  const { data: status } = useQuery({ queryKey: ["odoo-status"], queryFn: getOdooStatus });

  const real = useMemo(() => (providers?.providers ?? []).filter((p) => p.key !== "none"), [providers]);
  const [key, setKey] = useState<string | null>(null);
  const chosen = key ?? (providers ? (providers.default === "none" ? "none" : providers.default) : null);
  const provider = real.find((p) => p.key === chosen) ?? null;
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (provider) setForm(initialValues(provider, userEmail));
  }, [provider, userEmail]);

  const connect = useMutation({
    mutationFn: () => connectErp(provider!.key, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["odoo-status"] });
      qc.invalidateQueries({ queryKey: ["odoo-models"] });
      onChanged?.();
    },
  });
  const disconnect = useMutation({
    mutationFn: disconnectOdoo,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["odoo-status"] });
      onChanged?.();
    },
  });

  if (!providers) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const error = connect.error as { response?: { data?: { detail?: string } } } | null;
  const canSubmit =
    !!provider && provider.fields.every((f) => !f.required || (form[f.name] ?? "").trim()) && !connect.isPending;

  return (
    <div className={compact ? "space-y-3" : "max-w-lg space-y-4 rounded-lg border bg-card p-6"}>
      {status?.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-emerald-500/5 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>
              {status.label} connected{status.display_name ? ` as ${status.display_name}` : ""}
              {status.url ? ` · ${status.url}` : ""}
            </span>
          </div>
          <button
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {real.length > 1 || providers.default === "none" ? "Connect an ERP" : `Connect your ${real[0]?.label ?? "ERP"}`}
            </h2>
          </div>

          {(real.length > 1 || providers.default === "none") && (
            <div className="flex flex-wrap gap-2">
              {[...real, ...(providers.providers.filter((p) => p.key === "none"))].map((p) => (
                <button
                  key={p.key}
                  onClick={() => setKey(p.key)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${chosen === p.key ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}
                  title={p.description}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {provider ? (
            <>
              <p className="text-sm text-muted-foreground">{provider.description}</p>
              {provider.key === "odoo" && (
                <p className="text-sm text-muted-foreground">
                  Create an API key in Odoo under <span className="font-medium">your profile → Account Security → New API Key</span> and paste it below. Your key is encrypted before it is stored.
                </p>
              )}
              <div className="space-y-3">
                {provider.fields.map((f) => (
                  <label key={f.name} className="block space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">{f.label}</span>
                    <input
                      type={f.kind === "password" ? "password" : "text"}
                      value={form[f.name] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </label>
                ))}
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error.response?.data?.detail ?? "Connection failed. Check your details and try again."}</span>
                </div>
              )}
              <button
                onClick={() => connect.mutate()}
                disabled={!canSubmit}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                Connect
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No ERP. Gerry's ERP tools will say so instead of guessing; pick a provider above whenever the company adopts one.
            </p>
          )}
        </>
      )}
    </div>
  );
}
