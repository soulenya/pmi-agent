import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save, Trash2, Upload } from "lucide-react";

import {
  getDesign,
  logoUrl,
  removeLogo,
  resetDesign,
  saveDesign,
  uploadFont,
  uploadLogo,
  type BannerStyle,
  type DesignTokens,
} from "@/api/design";
import { BRAND } from "@/lib/brand";
import { applyAccent, ensureFontFace } from "@/lib/designTokens";
import { cn } from "@/lib/utils";

const COLOR_FIELDS: { key: keyof DesignTokens; label: string; hint: string }[] = [
  { key: "accent", label: "Accent", hint: "The one colour on documents and slides: title rule, eyebrows, indices." },
  { key: "ink", label: "Ink", hint: "Titles and headings on paper." },
  { key: "body", label: "Body text", hint: "Paragraph text on paper." },
  { key: "muted", label: "Muted", hint: "Captions, header and footer chrome." },
  { key: "hairline", label: "Hairline", hint: "Table rules and section dividers." },
  { key: "dark_background", label: "Dark ground", hint: "Slide and banner background." },
  { key: "dark_card", label: "Dark card", hint: "Cards on slides." },
  { key: "dark_text", label: "Text on dark", hint: "Titles on slides and banners." },
  { key: "dark_body", label: "Body on dark", hint: "Paragraphs on slides." },
  { key: "app_accent", label: "App accent", hint: "Buttons and focus rings in this app." },
];

function hsl(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function ratio(fg: string, bg: string): number {
  const lum = (hex: string) => {
    const ch = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(parseInt(hex.slice(0, 2), 16)) + 0.7152 * ch(parseInt(hex.slice(2, 4), 16)) + 0.0722 * ch(parseInt(hex.slice(4, 6), 16));
  };
  const a = lum(fg);
  const b = lum(bg);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}

function Contrast({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
      {label} {r.toFixed(1)}:1{ok ? "" : " — below 4.5"}
    </span>
  );
}

function errorText(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

export function DesignPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["design"], queryFn: getDesign });
  const [draft, setDraft] = useState<DesignTokens | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bust, setBust] = useState(0);
  const [fontFamily, setFontFamily] = useState("");
  const regularRef = useRef<HTMLInputElement>(null);
  const boldRef = useRef<HTMLInputElement>(null);
  const logoLightRef = useRef<HTMLInputElement>(null);
  const logoDarkRef = useRef<HTMLInputElement>(null);

  const tokens = draft ?? data?.tokens ?? null;

  useEffect(() => {
    if (!tokens) return;
    ensureFontFace(tokens.font_display);
    ensureFontFace(tokens.font_mono);
  }, [tokens?.font_display, tokens?.font_mono]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = (message: string, state?: { source: string; tokens: DesignTokens }) => {
    setError(null);
    setNote(message);
    setDraft(null);
    setBust(Date.now());
    if (state) applyAccent(state.source === "setting" ? hsl(state.tokens.app_accent) : null);
    qc.invalidateQueries({ queryKey: ["design"] });
  };

  const save = useMutation({
    mutationFn: () => saveDesign(draft ?? {}),
    onSuccess: (s) => done(s.problems?.length ? `Saved with notes: ${s.problems.join("; ")}` : "Saved — new documents and decks use these tokens.", s),
    onError: (e) => setError(errorText(e, "Couldn't save the design tokens.")),
  });
  const reset = useMutation({
    mutationFn: resetDesign,
    onSuccess: (s) => done("Back to the built-in design system.", s),
    onError: (e) => setError(errorText(e, "Couldn't reset.")),
  });
  const logo = useMutation({
    mutationFn: ({ kind, file }: { kind: "light" | "dark"; file: File }) => uploadLogo(kind, file),
    onSuccess: (s) => done("Logo saved.", s),
    onError: (e) => setError(errorText(e, "Couldn't save the logo.")),
  });
  const dropLogo = useMutation({
    mutationFn: (kind: "light" | "dark") => removeLogo(kind),
    onSuccess: (s) => done("Logo removed.", s),
    onError: (e) => setError(errorText(e, "Couldn't remove the logo.")),
  });
  const font = useMutation({
    mutationFn: () => {
      const reg = regularRef.current?.files?.[0];
      const bold = boldRef.current?.files?.[0];
      if (!fontFamily.trim() || !reg || !bold) throw new Error("Family name, Regular and Bold files are all required.");
      return uploadFont(fontFamily.trim(), reg, bold);
    },
    onSuccess: () => {
      done("Font uploaded — choose it in the Display or Mono list.");
      setFontFamily("");
      if (regularRef.current) regularRef.current.value = "";
      if (boldRef.current) boldRef.current.value = "";
    },
    onError: (e) => setError(e instanceof Error && !("response" in e) ? e.message : errorText(e, "Couldn't upload the font.")),
  });

  if (isLoading || !data || !tokens) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const set = <K extends keyof DesignTokens>(key: K, value: DesignTokens[K]) =>
    setDraft({ ...(draft ?? data.tokens), [key]: value });
  const busy = save.isPending || reset.isPending || logo.isPending || dropLogo.isPending || font.isPending;
  const dirty = draft !== null;
  const fonts = data.fonts.filter((f) => f.available);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border px-2 py-0.5">
          {data.source === "setting" ? "Company tokens in use" : `Built-in design system${BRAND.isPmi ? " (Precisian Medical)" : ""}`}
        </span>
        <Contrast fg={tokens.body} bg="FFFFFF" label="body on paper" />
        <Contrast fg={tokens.dark_text} bg={tokens.dark_background} label="title on dark" />
        <Contrast fg="FFFFFF" bg={tokens.app_accent} label="white on app accent" />
      </div>

      {/* Preview */}
      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2")}>
        <div
          className="rounded-md border p-5 shadow-sm"
          style={{ background: "#FFFFFF", color: `#${tokens.body}`, fontFamily: `"${tokens.font_display}", system-ui` }}
        >
          <div className="text-[9px] tracking-[0.16em]" style={{ color: `#${tokens.accent}`, fontFamily: `"${tokens.font_mono}", monospace` }}>
            {tokens.eyebrow_caps ? "WEEKLY UPDATE · 04" : "Weekly update · 04"}
          </div>
          <div
            className="mt-1 text-xl font-bold leading-tight"
            style={{ color: `#${tokens.ink}`, borderBottom: tokens.title_rule ? `3px solid #${tokens.accent}` : "none", paddingBottom: 6 }}
          >
            Programme status
          </div>
          <div className="mt-3 text-sm font-bold" style={{ color: `#${tokens.ink}`, borderTop: tokens.section_hairlines ? `1px solid #${tokens.hairline}` : "none", paddingTop: 8 }}>
            1. Where we are
          </div>
          <p className="mt-1 text-[12px] leading-relaxed">Facts, plainly. The design system decides how they look; the Style Guide decides how they read.</p>
          <div className="mt-3 flex justify-between text-[8px] tracking-[0.16em]" style={{ color: `#${tokens.muted}`, fontFamily: `"${tokens.font_mono}", monospace` }}>
            <span>{(tokens.footer_wording || BRAND.companyName).toUpperCase()}</span>
            <span>PAGE 1 OF 3</span>
          </div>
        </div>
        <div
          className="flex flex-col justify-between rounded-md border p-5 shadow-sm"
          style={{ background: `#${tokens.dark_background}`, color: `#${tokens.dark_body}`, fontFamily: `"${tokens.font_display}", system-ui`, minHeight: 150 }}
        >
          <div className="text-[9px] tracking-[0.16em]" style={{ color: `#${tokens.accent}`, fontFamily: `"${tokens.font_mono}", monospace` }}>
            {tokens.eyebrow_caps ? "01 — OVERVIEW" : "01 — Overview"}
          </div>
          <div className="text-2xl font-bold leading-tight" style={{ color: `#${tokens.dark_text}` }}>
            {tokens.deck_name || BRAND.companyShort}
          </div>
          <div className="rounded px-3 py-2 text-[11px]" style={{ background: `#${tokens.dark_card}` }}>
            A card on the dark ground.
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded px-2 py-1 text-[11px] font-medium text-white" style={{ background: `#${tokens.app_accent}` }}>
              App button
            </span>
            {data.logos.dark && <img src={logoUrl("dark", bust)} alt="" className="h-6 object-contain" />}
          </div>
        </div>
      </div>

      {/* Fonts */}
      <div className="rounded-lg border px-4 py-3 space-y-2">
        <p className="text-sm font-medium">Type</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["font_display", "font_mono"] as const).map((key) => (
            <label key={key} className="text-xs text-muted-foreground">
              {key === "font_display" ? "Display and body" : "Mono (labels, chrome)"}
              <select
                value={tokens[key]}
                onChange={(e) => set(key, e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                disabled={busy}
              >
                {fonts.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.family}{f.source === "uploaded" ? " (uploaded)" : ""}
                  </option>
                ))}
                {!fonts.some((f) => f.family === tokens[key]) && <option value={tokens[key]}>{tokens[key]}</option>}
              </select>
            </label>
          ))}
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Upload a font (Regular + Bold, .ttf or .otf)</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              placeholder="Family name"
              className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            />
            <label>Regular <input ref={regularRef} type="file" accept=".ttf,.otf" className="block text-xs" /></label>
            <label>Bold <input ref={boldRef} type="file" accept=".ttf,.otf" className="block text-xs" /></label>
            <button
              onClick={() => font.mutate()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {font.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
            </button>
          </div>
        </details>
      </div>

      {/* Colours */}
      <div className="rounded-lg border px-4 py-3 space-y-2">
        <p className="text-sm font-medium">Colours</p>
        <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-5")}>
          {COLOR_FIELDS.map((f) => (
            <label key={f.key} className="text-xs text-muted-foreground" title={f.hint}>
              {f.label}
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  type="color"
                  value={`#${tokens[f.key]}`}
                  onChange={(e) => set(f.key, e.target.value.slice(1).toUpperCase() as never)}
                  className="h-7 w-9 cursor-pointer rounded border bg-background p-0.5"
                  disabled={busy}
                />
                <input
                  value={String(tokens[f.key])}
                  onChange={(e) => set(f.key, e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6).toUpperCase() as never)}
                  className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground"
                  disabled={busy}
                />
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Logos */}
      <div className="rounded-lg border px-4 py-3 space-y-2">
        <p className="text-sm font-medium">Logos (PNG, transparent background)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["light", "dark"] as const).map((kind) => {
            const present = data.logos[kind];
            const ref = kind === "light" ? logoLightRef : logoDarkRef;
            return (
              <div key={kind} className="flex items-center gap-3">
                <div
                  className="flex h-14 w-24 items-center justify-center rounded border"
                  style={{ background: kind === "light" ? "#FFFFFF" : `#${tokens.dark_background}` }}
                >
                  {present ? <img src={logoUrl(kind, bust)} alt="" className="max-h-12 max-w-[88px] object-contain" /> : <span className="text-[10px] text-muted-foreground">none</span>}
                </div>
                <div className="space-y-1 text-xs">
                  <p className="font-medium text-foreground">{kind === "light" ? "Mark on light ground" : "Mark on dark ground"}</p>
                  <p className="text-muted-foreground">{kind === "light" ? "Document covers." : "Login page, slides, banners."}</p>
                  <div className="flex gap-2">
                    <input ref={ref} type="file" accept="image/png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) logo.mutate({ kind, file: f }); }} />
                    <button onClick={() => ref.current?.click()} disabled={busy} className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">Upload</button>
                    {present && (tokens[kind === "light" ? "logo_light" : "logo_dark"] || !BRAND.isPmi) && (
                      <button onClick={() => dropLogo.mutate(kind)} disabled={busy} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rules */}
      <div className="rounded-lg border px-4 py-3 space-y-2">
        <p className="text-sm font-medium">Patterns</p>
        <div className="grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-2"><input type="checkbox" checked={tokens.title_rule} onChange={(e) => set("title_rule", e.target.checked)} /> Accent rule under the title</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={tokens.section_hairlines} onChange={(e) => set("section_hairlines", e.target.checked)} /> Hairline above each section heading</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={tokens.eyebrow_caps} onChange={(e) => set("eyebrow_caps", e.target.checked)} /> Labels in uppercase</label>
          <label className="flex items-center gap-2" title="Documents whose title reads as FDA/QMS/risk/regulatory keep plain controlled-document styling.">
            <input type="checkbox" checked={tokens.controlled_exempt} onChange={(e) => set("controlled_exempt", e.target.checked)} /> Controlled documents keep plain styling
          </label>
          <label>
            Banner style
            <select value={tokens.banner_style} onChange={(e) => set("banner_style", e.target.value as BannerStyle)} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="dark">Dark ground</option>
              <option value="accent">Accent ground</option>
              <option value="none">No fill</option>
            </select>
          </label>
          <label>
            Footer wording (blank = company name)
            <input value={tokens.footer_wording} onChange={(e) => set("footer_wording", e.target.value)} placeholder={BRAND.companyName} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label>
            Deck cover name
            <input value={tokens.deck_name} onChange={(e) => set("deck_name", e.target.value)} placeholder={BRAND.flagship || BRAND.companyShort} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={busy || !dirty}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save design
        </button>
        {dirty && (
          <button onClick={() => setDraft(null)} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Discard changes</button>
        )}
        <button
          onClick={() => reset.mutate()}
          disabled={busy || data.source !== "setting"}
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {reset.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Use built-in design
        </button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
