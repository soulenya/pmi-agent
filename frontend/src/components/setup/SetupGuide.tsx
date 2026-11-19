/**
 * The setup guide: a "Would you like to..." popup of connections to set up,
 * each with what it is, why it is there, what you gain, what it costs, what
 * comes with it, and the steps to do it right here.
 *
 * Opens by itself for a brand with the `setup_guide` feature until the person
 * says "Don't show this again"; always available from the menu under their
 * name. What it explains is in guideContent.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  FolderOpen,
  Loader2,
  Mail,
  Mic,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from "lucide-react";

import { connectGoogleOnHub, getGoogleStatus, startGoogleAuth } from "@/api/google";
import { sendTestPush } from "@/api/push";
import { getAiOptions, getSettings, testConnection, updateSettings } from "@/api/settings";
import type { SettingsUpdate } from "@/api/settings";
import { getSetupGuide, setSetupGuideDismissed } from "@/api/setupGuide";
import type { KeySource, SetupGuideState } from "@/api/setupGuide";
import { usePush } from "@/hooks/usePush";
import { BRAND, hasOptInFeature } from "@/lib/brand";
import { openExternal } from "@/lib/externalLinks";
import { useSetupGuideStore } from "@/stores/setupGuideStore";
import { GUIDE_ITEMS } from "./guideContent";
import type { GuideItem, GuideItemId } from "./guideContent";

type Status = { state: "done" | "todo" | "waiting"; label: string };

const ICONS: Record<GuideItemId, typeof Bell> = {
  google: FolderOpen,
  gmail: Mail,
  ai: Sparkles,
  embeddings: Search,
  voice: Mic,
  notifications: Bell,
  settings: SettingsIcon,
};

type ProviderId = "anthropic" | "openai" | "voyage" | "google";

interface ProviderChoice {
  id: ProviderId;
  label: string;
  note: string;
  placeholder: string;
  url: string;
  urlLabel: string;
  steps: string[];
}

const ANTHROPIC: ProviderChoice = {
  id: "anthropic",
  label: "Claude (Anthropic)",
  note: "Recommended. Reads scanned documents and images as well as text.",
  placeholder: "sk-ant-...",
  url: "https://console.anthropic.com/",
  urlLabel: "Open the Anthropic Console",
  steps: [
    "Open the Anthropic Console and create an account with your work email.",
    "Under Billing, add a payment method and buy some credit. Set a monthly limit while you are there.",
    'Under API keys, choose "Create key", name it after this app, and copy it. It is shown only once.',
    "Paste it below and save.",
  ],
};

const OPENAI: ProviderChoice = {
  id: "openai",
  label: "OpenAI",
  note: "Works for chat and writing. Cannot read scanned documents or images in this app.",
  placeholder: "sk-...",
  url: "https://platform.openai.com/api-keys",
  urlLabel: "Open the OpenAI platform",
  steps: [
    "Open the OpenAI platform and create an account with your work email. This is separate from a ChatGPT subscription.",
    "Under Billing, add a payment method and some credit, and set a monthly limit.",
    'Under API keys, choose "Create new secret key" and copy it. It is shown only once.',
    "Paste it below and save.",
  ],
};

const VOYAGE: ProviderChoice = {
  id: "voyage",
  label: "Voyage AI",
  note: "Recommended. Made for search, and what this app is tuned for.",
  placeholder: "pa-...",
  url: "https://dash.voyageai.com/",
  urlLabel: "Open the Voyage dashboard",
  steps: [
    "Open the Voyage dashboard and create an account with your work email.",
    'Under API keys, choose "Create new secret key" and copy it.',
    "Paste it below and save. Add a payment method there only once the free allowance runs out.",
  ],
};

const GOOGLE_SPEECH: ProviderChoice = {
  id: "google",
  label: "Google Cloud speech",
  note: "One key for both listening and speaking.",
  placeholder: "AIza...",
  url: "https://console.cloud.google.com/apis/credentials",
  urlLabel: "Open Google Cloud credentials",
  steps: [
    "Open Google Cloud credentials, signed in with the account that manages your company's Google Cloud, and pick your company's project at the top.",
    'Choose "Create credentials", then "API key".',
    'Open the new key, and under "API restrictions" choose "Restrict key" and tick Cloud Speech-to-Text API and Cloud Text-to-Speech API. Save.',
    "Copy the key, paste it below and save.",
  ],
};

const CHOICES: Partial<Record<GuideItemId, ProviderChoice[]>> = {
  ai: [ANTHROPIC, OPENAI],
  embeddings: [VOYAGE, { ...OPENAI, note: "Use the same OpenAI key as above; no second account." }],
  voice: [GOOGLE_SPEECH],
};

function errorText(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (!err.response) return "Could not reach the server. Check your connection and try again.";
  }
  return fallback;
}

function keyStatus(source: KeySource | undefined, canSet: boolean): Status {
  if (source) return { state: "done", label: source === "server" ? "Set up on the server" : "Set up" };
  return canSet
    ? { state: "todo", label: "Not set up" }
    : { state: "waiting", label: "Waiting for your administrator" };
}

export function SetupGuideModal() {
  // Decided when the app is built for a brand, so the hooks below never change order.
  if (!hasOptInFeature("setup_guide")) return null;
  return <SetupGuide />;
}

function SetupGuide() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const requests = useSetupGuideStore((s) => s.requests);
  const setBlocking = useSetupGuideStore((s) => s.setBlocking);
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState(false);
  // The tick shows from local state at once; the saved answer follows.
  const [dismissedNow, setDismissedNow] = useState<boolean | null>(null);
  const [active, setActive] = useState<GuideItemId | null>(null);
  const autoOpened = useRef(false);

  const guide = useQuery({ queryKey: ["setup-guide"], queryFn: getSetupGuide, staleTime: 30_000 });
  const google = useQuery({
    queryKey: ["setup-guide", "google"],
    queryFn: getGoogleStatus,
    enabled: open,
    // A desktop finishes the Google sign-in in another window; keep looking.
    refetchInterval: (q) => (open && !q.state.data?.connected ? 4000 : false),
  });
  const settings = useQuery({ queryKey: ["setup-guide", "settings"], queryFn: getSettings, enabled: open });
  const push = usePush();

  // Asked for from the menu.
  useEffect(() => {
    if (requests === 0) return;
    setActive(null);
    setOpen(true);
  }, [requests]);

  // The first thing a new person sees, until they put it away.
  useEffect(() => {
    if (autoOpened.current || !guide.data) return;
    autoOpened.current = true;
    if (guide.data.enabled && !guide.data.dismissed) setOpen(true);
    setDecided(true);
  }, [guide.data]);

  // Other first-run popups wait while this is up, or still making up its mind.
  useEffect(() => {
    setBlocking(open || !(decided || guide.isError));
  }, [open, decided, guide.isError, setBlocking]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (active) setActive(null);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, active, close]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["setup-guide"] });
  }, [qc]);

  if (!open || !guide.data) return null;
  const state = guide.data;

  // Notifications reach a browser or phone through the hub; the desktop app has its own bell.
  const items = GUIDE_ITEMS.filter((i) => i.id !== "notifications" || state.on_hub);

  function statusOf(id: GuideItemId): Status | null {
    switch (id) {
      case "google":
      case "gmail":
        if (google.data?.connected) return { state: "done", label: "Connected" };
        return { state: "todo", label: "Not connected" };
      case "ai": {
        const provider = settings.data?.llm_provider === "openai" ? "openai" : "anthropic";
        return keyStatus(state.keys[provider], state.can_set_keys);
      }
      case "embeddings": {
        const provider = settings.data?.embedding_provider === "openai" ? "openai" : "voyage";
        return keyStatus(state.keys[provider], state.can_set_keys);
      }
      case "voice":
        return keyStatus(state.keys.google, state.can_set_keys);
      case "notifications":
        if (push.state === "on") return { state: "done", label: "On for this device" };
        return { state: "todo", label: "Off for this device" };
      default:
        return null;
    }
  }

  const tracked = items.filter((i) => statusOf(i.id));
  const doneCount = tracked.filter((i) => statusOf(i.id)?.state === "done").length;
  const current = active ? items.find((i) => i.id === active) : undefined;
  const index = current ? items.indexOf(current) : -1;
  const next = index >= 0 ? items[index + 1] : undefined;

  async function setDismissed(dismissed: boolean) {
    setDismissedNow(dismissed);
    try {
      qc.setQueryData<SetupGuideState>(["setup-guide"], await setSetupGuideDismissed(dismissed));
    } catch {
      setDismissedNow(null);
      refresh();
    }
  }

  return (
    // Above the system notices (z-70): they say the same things less helpfully, and would cover the list.
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Setup guide"
        data-state="open"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-5 py-4">
          {current && (
            <button onClick={() => setActive(null)} className="rounded-md p-1 hover:bg-accent" aria-label="Back to the list">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold">
              {current ? current.title : `Welcome to ${BRAND.productName}`}
            </h3>
            {!current && (
              <p className="text-xs text-muted-foreground">
                {doneCount} of {tracked.length} set up. Do them in any order, now or later.
              </p>
            )}
          </div>
          {current && <StatusPill status={statusOf(current.id)} />}
          <button onClick={close} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {!current ? (
            <>
              <p className="mb-3 text-sm font-medium">Would you like to...</p>
              <ul className="space-y-2">
                {items.map((item) => {
                  const Icon = ICONS[item.id];
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => setActive(item.id)}
                        className="flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left hover:bg-accent"
                      >
                        <Icon className="h-5 w-5 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">...{item.question}?</span>
                          <span className="block text-xs text-muted-foreground">{item.summary}</span>
                        </span>
                        <StatusPill status={statusOf(item.id)} />
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <Detail item={current}>
              {(current.id === "google" || current.id === "gmail") && (
                <GoogleStep
                  onHub={state.on_hub}
                  connected={google.data?.connected === true}
                  email={google.data?.email}
                  configured={google.data?.configured !== false}
                />
              )}
              {CHOICES[current.id] && (
                <KeyStep
                  key={current.id}
                  kind={current.id as "ai" | "embeddings" | "voice"}
                  choices={CHOICES[current.id]!}
                  guide={state}
                  onChanged={refresh}
                />
              )}
              {current.id === "notifications" && <PushStep push={push} serverReady={state.push_ready} />}
              {current.id === "settings" && (
                <button
                  onClick={() => {
                    close();
                    navigate("/settings");
                  }}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Open Settings
                </button>
              )}
            </Detail>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
          {current ? (
            <>
              <button onClick={() => setActive(null)} className="text-sm text-muted-foreground hover:text-foreground">
                Back to the list
              </button>
              {next && (
                <button
                  onClick={() => setActive(next.id)}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  Next: {next.title}
                </button>
              )}
            </>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={dismissedNow ?? state.dismissed}
                  onChange={(e) => void setDismissed(e.target.checked)}
                />
                Don&apos;t show this again. It stays under your name in the menu.
              </label>
              <button
                onClick={close}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {doneCount === tracked.length ? "Done" : "Finish later"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status | null }) {
  if (!status) return null;
  const done = status.state === "done";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {done ? <Check className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
      {status.label}
    </span>
  );
}

function Detail({ item, children }: { item: GuideItem; children: React.ReactNode }) {
  return (
    <div className="space-y-4 text-sm">
      <Section title="What it is">{item.what}</Section>
      <Section title="Why it is here">{item.why}</Section>
      <Section title="What you gain">
        <Bullets items={item.gain} />
      </Section>
      <Section title="What it costs">{item.cost}</Section>
      <Section title="Strings attached">
        <Bullets items={item.strings} />
      </Section>
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {item.id === "settings" ? "Go there" : "Set it up"}
        </p>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((text) => (
        <li key={text} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 text-primary">•</span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function Message({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className={`mt-2 text-xs ${ok ? "text-primary" : "text-destructive"}`} role="status">
      {children}
    </p>
  );
}

function GoogleStep({
  onHub,
  connected,
  email,
  configured,
}: {
  onHub: boolean;
  connected: boolean;
  email?: string;
  configured: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (connected) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <Check className="h-4 w-4 text-primary" />
        Connected{email ? ` as ${email}` : ""}. Google Workspace and Gmail are both ready.
      </p>
    );
  }
  if (!configured) {
    return (
      <p className="text-sm">
        Google sign-in has not been set up on this server yet. That is done once by whoever installed it; nothing you
        can do here will change it.
      </p>
    );
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      // The hub sends this browser to Google and back; a desktop opens Google in its own window.
      if (onHub) await connectGoogleOnHub();
      else await startGoogleAuth();
    } catch (e) {
      setError(errorText(e, "Could not start the Google sign-in. Try again."));
      setBusy(false);
    }
  }

  return (
    <div>
      <ol className="mb-3 list-decimal space-y-1 pl-5">
        <li>Press the button. Google opens and asks which account: choose your work account.</li>
        <li>Google lists what the app is asking for. Tick every box and press Continue.</li>
        <li>You come back here, and this says Connected.</li>
      </ol>
      <button
        onClick={() => void connect()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Connect Google
      </button>
      {busy && !onHub && <Message ok>Finish in the Google window that opened. This will update by itself.</Message>}
      {error && <Message ok={false}>{error}</Message>}
    </div>
  );
}

function KeyStep({
  kind,
  choices,
  guide,
  onChanged,
}: {
  kind: "ai" | "embeddings" | "voice";
  choices: ProviderChoice[];
  guide: SetupGuideState;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["setup-guide", "settings"], queryFn: getSettings });
  const options = useQuery({ queryKey: ["setup-guide", "ai-options"], queryFn: getAiOptions, enabled: kind !== "voice" });

  const inUse =
    kind === "ai" ? settings.data?.llm_provider : kind === "embeddings" ? settings.data?.embedding_provider : "google";
  const [picked, setPicked] = useState<ProviderId | null>(null);
  const choice = choices.find((c) => c.id === (picked ?? inUse)) ?? choices[0];

  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [model, setModel] = useState("");

  const source = guide.keys[choice.id];
  const models = (kind === "ai" ? options.data?.llm : options.data?.embedding)?.[choice.id] ?? [];
  const currentModel = kind === "ai" ? settings.data?.llm_model : settings.data?.embedding_model;
  const using = kind === "voice" ? Boolean(source) : inUse === choice.id && Boolean(source);

  function reload() {
    onChanged();
    void qc.invalidateQueries({ queryKey: ["setup-guide", "settings"] });
    void qc.invalidateQueries({ queryKey: ["setup-guide", "ai-options"] });
  }

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      await updateSettings({ [`${choice.id}_api_key`]: key.trim() } as SettingsUpdate);
      setKey("");
      if (choice.id === "anthropic" || choice.id === "openai") {
        const test = await testConnection(choice.id);
        setResult({ ok: test.ok, text: test.ok ? "Saved, and the key works." : `Saved, but it did not work: ${test.message}` });
      } else {
        setResult({ ok: true, text: "Saved." });
      }
      reload();
    } catch (e) {
      setResult({ ok: false, text: errorText(e, "Could not save the key. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function use() {
    const chosen = model || models[0];
    if (!chosen) return;
    setBusy(true);
    setResult(null);
    try {
      await updateSettings(
        kind === "ai"
          ? { llm_provider: choice.id, llm_model: chosen }
          : { embedding_provider: choice.id, embedding_model: chosen },
      );
      setResult({ ok: true, text: `${BRAND.assistantName} now uses ${choice.label}.` });
      reload();
    } catch (e) {
      setResult({ ok: false, text: errorText(e, "Could not switch. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  if (!guide.can_set_keys) {
    return (
      <p className="text-sm">
        {source
          ? "Your administrator has set this up for the whole company. There is nothing for you to do."
          : "This is set once for the whole company by an administrator, and it has not been done yet. Ask them to open this guide."}
      </p>
    );
  }

  return (
    <div>
      {choices.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setPicked(c.id);
                setResult(null);
                setModel("");
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                c.id === choice.id ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <p className="mb-3 text-xs text-muted-foreground">{choice.note}</p>

      {source === "server" ? (
        <p className="text-sm">
          A {choice.label} key is already set on the server by whoever runs it. It is used as it is and cannot be
          changed from here.
        </p>
      ) : (
        <>
          <ol className="mb-3 list-decimal space-y-1 pl-5">
            {choice.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <button
            onClick={() => openExternal(choice.url)}
            className="mb-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {choice.urlLabel}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={source ? "A key is saved. Paste a new one to replace it." : choice.placeholder}
              aria-label={`${choice.label} key`}
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={() => void save()}
              disabled={busy || key.trim().length < 8}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        </>
      )}

      {kind !== "voice" && source && !using && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {models.length > 0 ? (
            <>
              <select
                value={model || models[0]}
                onChange={(e) => setModel(e.target.value)}
                aria-label="Model"
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void use()}
                disabled={busy}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
              >
                Use {choice.label}
              </button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              The key is saved. Choose {choice.label} under Settings, AI Models, to start using it.
            </p>
          )}
        </div>
      )}
      {using && (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-primary" />
          {kind === "voice"
            ? "Voice is ready. Pick the speaking voice under Settings."
            : `${BRAND.assistantName} is using ${choice.label}${currentModel ? ` (${currentModel})` : ""}.`}
        </p>
      )}
      {result && <Message ok={result.ok}>{result.text}</Message>}
    </div>
  );
}

function PushStep({ push, serverReady }: { push: ReturnType<typeof usePush>; serverReady: boolean }) {
  const [test, setTest] = useState<string | null>(null);

  async function sendTest() {
    setTest(null);
    try {
      const r = await sendTestPush();
      setTest(r.delivered > 0 ? "Sent. It should appear in a moment." : "Nothing was sent: no device is subscribed.");
    } catch {
      setTest("Could not send a test.");
    }
  }

  if (!serverReady || push.state === "server_off") {
    return <p className="text-sm">Notifications are not available on this server yet.</p>;
  }
  if (push.state === "needs_home_screen") {
    return (
      <p className="text-sm">
        On an iPhone: tap Share, then Add to Home Screen, and open the app from its new icon. Then come back to this
        guide (under your name in the menu) and turn notifications on.
      </p>
    );
  }
  if (push.state === "unsupported") {
    return <p className="text-sm">This browser cannot receive notifications. Chrome, Edge and Firefox can.</p>;
  }
  if (push.state === "denied") {
    return (
      <p className="text-sm">
        This browser has been told to block notifications from this site. Allow them in the browser&apos;s site settings
        (the icon at the left of the address bar), then reload.
      </p>
    );
  }
  if (push.state === "on") {
    return (
      <div>
        <p className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-primary" />
          Notifications are on for this device.
        </p>
        <button onClick={() => void sendTest()} className="mt-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          Send a test
        </button>
        {test && <Message ok>{test}</Message>}
      </div>
    );
  }
  return (
    <div>
      <ol className="mb-3 list-decimal space-y-1 pl-5">
        <li>Press the button.</li>
        <li>Your browser asks whether this site may send notifications. Choose Allow.</li>
      </ol>
      <button
        onClick={() => void push.enable()}
        disabled={push.state === "busy"}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {push.state === "busy" && <Loader2 className="h-4 w-4 animate-spin" />}
        Turn on notifications
      </button>
      {push.error && <Message ok={false}>{push.error}</Message>}
    </div>
  );
}
