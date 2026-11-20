/**
 * Email from the pipeline, in a popup: one lead, or everyone chosen from the
 * leads on screen. Each person gets their own copy from the sender's Gmail,
 * and every email sent is written into that lead's history.
 *
 * Sending to many is in two steps on purpose: write it, then look at exactly
 * who it goes to and how the first one reads before anything leaves.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Loader2, Send, X } from "lucide-react";

import { getEmailJob, getEmailSetup, previewEmail, sendEmail, sendTestEmail } from "@/api/pipeline";
import type { EmailDraft, EmailPreview, PipelineLead } from "@/api/pipeline";

function errorText(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (!err.response) return "Could not reach the server.";
  }
  return fallback;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usable = (lead: PipelineLead) => /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(lead.email.trim());
const TOKEN_LABEL: Record<string, string> = { first_name: "first name", name: "name", company: "company" };

export function EmailLeadsDialog({
  leads,
  single = false,
  onClose,
  onSent,
}: {
  /** One lead, or the leads on screen to choose from. */
  leads: PipelineLead[];
  /** Writing to one person: no list to choose from, and no review step. */
  single?: boolean;
  onClose: () => void;
  /** Something was sent: the leads' histories have changed. */
  onSent: () => void;
}) {
  const setup = useQuery({ queryKey: ["pipeline", "email-setup"], queryFn: getEmailSetup, retry: false, staleTime: 60_000 });
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(leads.filter(usable).map((l) => l.id)));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<"write" | "review" | "sending">("write");
  const [look, setLook] = useState<EmailPreview | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);

  // Start the message with the sender's signature, unless they have begun typing.
  const signature = setup.data?.signature ?? "";
  useEffect(() => {
    if (!touched && signature) setBody(`\n\n${signature}`);
  }, [signature, touched]);

  const draft: EmailDraft = useMemo(
    () => ({ lead_ids: leads.filter((l) => chosen.has(l.id)).map((l) => l.id), subject, body }),
    [leads, chosen, subject, body],
  );
  const ready = draft.lead_ids.length > 0 && subject.trim() !== "" && body.trim() !== "" && setup.data?.connected === true;
  const fail = (fallback: string) => (e: unknown) => setError(errorText(e, fallback));

  const review = useMutation({
    mutationFn: () => previewEmail(draft),
    onSuccess: (r) => {
      setLook(r);
      setError(null);
      setStep("review");
    },
    onError: fail("Could not prepare the email."),
  });
  const test = useMutation({
    mutationFn: () => sendTestEmail(draft),
    onSuccess: (r) => {
      setTested(`A test was sent to ${r.sent_to}.`);
      setError(null);
    },
    onError: fail("The test could not be sent."),
  });
  const send = useMutation({
    mutationFn: () => sendEmail(draft),
    onSuccess: (job) => {
      setJobId(job.id);
      setError(null);
      setStep("sending");
    },
    onError: fail("The email could not be sent."),
  });
  const job = useQuery({
    queryKey: ["pipeline", "email-job", jobId],
    queryFn: () => getEmailJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data?.done ? false : 1500),
    // Keep counting when the person has switched to another tab: a long list takes minutes.
    refetchIntervalInBackground: true,
  });
  const finished = job.data?.done === true;
  useEffect(() => {
    if (finished) onSent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const one = leads[0];
  const title = single ? `Email ${one?.contact_name || one?.title || "this contact"}` : "Email leads";
  const field = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  const quiet = "rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60";
  const primary =
    "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60";
  const withEmail = leads.filter(usable);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {setup.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : setup.data?.connected !== true ? (
            <p className="rounded-md border p-3">
              <span className="font-medium">Email goes out from your own Gmail.</span>{" "}
              <span className="text-muted-foreground">
                Connect your Google account on the hub first (Settings → Connections, in the hub&apos;s web app), then
                come back here.
              </span>
            </p>
          ) : step === "write" ? (
            <>
              <p className="text-xs text-muted-foreground">
                From {setup.data.from}.{" "}
                {single ? `To ${one?.email}.` : "Each person gets their own copy and does not see the others."}
              </p>
              {!single && (
                <div className="rounded-md border">
                  <div className="flex items-center gap-3 border-b px-3 py-2 text-xs">
                    <span className="mr-auto font-medium">
                      {chosen.size} of {withEmail.length} selected
                    </span>
                    <button onClick={() => setChosen(new Set(withEmail.map((l) => l.id)))} className="underline hover:text-foreground">
                      Select all
                    </button>
                    <button onClick={() => setChosen(new Set())} className="underline hover:text-foreground">
                      Clear
                    </button>
                  </div>
                  <ul className="max-h-44 divide-y overflow-y-auto" aria-label="Recipients">
                    {leads.map((lead) => {
                      const ok = usable(lead);
                      return (
                        <li key={lead.id}>
                          <label className={`flex items-center gap-2 px-3 py-1.5 ${ok ? "cursor-pointer hover:bg-accent" : "text-muted-foreground"}`}>
                            <input
                              type="checkbox"
                              disabled={!ok}
                              checked={chosen.has(lead.id)}
                              onChange={(e) =>
                                setChosen((s) => {
                                  const next = new Set(s);
                                  if (e.target.checked) next.add(lead.id);
                                  else next.delete(lead.id);
                                  return next;
                                })
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {lead.title}
                              {lead.contact_name && lead.contact_name !== lead.title ? ` · ${lead.contact_name}` : ""}
                            </span>
                            <span className="shrink-0 truncate text-xs text-muted-foreground">{ok ? lead.email : "no email address"}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" className={field} />
              <textarea
                value={body}
                onChange={(e) => {
                  setTouched(true);
                  setBody(e.target.value);
                }}
                rows={11}
                placeholder={single ? "Write your message" : "Hi {first_name},"}
                aria-label="Message"
                className={`${field} resize-y`}
              />
              <p className="text-xs text-muted-foreground">
                {"{first_name}"}, {"{name}"} and {"{company}"} are filled in for each person. It is recorded in the
                lead&apos;s history when it has gone.
              </p>
            </>
          ) : step === "review" && look ? (
            <>
              <p className="font-medium">
                {look.recipients === 1 ? "One email" : `${look.recipients} separate emails`} will be sent from {setup.data.from}.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {look.leads > look.recipients && (
                  <li>
                    {plural(look.leads, "lead")} chosen; some share an address, and each address gets one email.
                  </li>
                )}
                {look.without_email.length > 0 && (
                  <li>
                    {plural(look.without_email.length, "lead")} left out for having no usable email address:{" "}
                    {look.without_email.slice(0, 6).join(", ")}
                    {look.without_email.length > 6 ? ", …" : ""}.
                  </li>
                )}
                {Object.entries(look.missing)
                  .filter(([, n]) => n > 0)
                  .map(([token, n]) => (
                    <li key={token}>
                      {plural(n, "person", "people")} {n === 1 ? "has" : "have"} no {TOKEN_LABEL[token] ?? token} on file and will read
                      &ldquo;{look.fallbacks[token]}&rdquo; there.
                    </li>
                  ))}
                {look.too_many && <li className="text-destructive">One send goes to at most {look.limit} people. Choose fewer.</li>}
              </ul>
              {look.sample && (
                <div className="rounded-md border" aria-label="How the first one reads">
                  <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                    The first one, as it will arrive · To {look.sample.to}
                  </p>
                  <p className="border-b px-3 py-2 font-medium">{look.sample.subject}</p>
                  <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-sans">{look.sample.body}</pre>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Once sent, an email cannot be taken back.</p>
            </>
          ) : (
            <div role="status" className="space-y-2">
              {!job.data ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Starting…
                </p>
              ) : !job.data.done ? (
                <>
                  <p className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Sent {job.data.sent} of {job.data.total}…
                  </p>
                  <p className="text-xs text-muted-foreground">You can close this. Sending carries on, and each lead&apos;s history records it.</p>
                </>
              ) : (
                <>
                  <p className="font-medium">
                    {job.data.sent === 0 ? "Nothing was sent." : `Sent to ${plural(job.data.sent, "person", "people")}.`}
                  </p>
                  {job.data.stopped && <p className="text-destructive">{job.data.stopped}</p>}
                  {job.data.failed.length > 0 && (
                    <>
                      <p>{plural(job.data.failed.length, "email")} did not go:</p>
                      <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-muted-foreground">
                        {job.data.failed.map((f) => (
                          <li key={f.to}>
                            {f.to}: {f.reason}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {error && <p className="text-destructive" role="alert">{error}</p>}
          {tested && step === "write" && <p className="text-xs text-muted-foreground" role="status">{tested}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {step === "write" && setup.data?.connected === true ? (
            <>
              <button onClick={onClose} className={`${quiet} mr-auto`}>
                Cancel
              </button>
              <button onClick={() => test.mutate()} disabled={!ready || test.isPending} className={quiet}>
                {test.isPending ? "Sending the test…" : "Send a test to me"}
              </button>
              {single ? (
                <button onClick={() => send.mutate()} disabled={!ready || send.isPending} className={primary}>
                  <Send className="h-4 w-4" /> {send.isPending ? "Sending…" : "Send"}
                </button>
              ) : (
                <button onClick={() => review.mutate()} disabled={!ready || review.isPending} className={primary}>
                  {review.isPending ? "Preparing…" : `Review (${chosen.size})`}
                </button>
              )}
            </>
          ) : step === "review" && look ? (
            <>
              <button onClick={() => setStep("write")} className={`${quiet} mr-auto`}>
                Back
              </button>
              <button onClick={() => send.mutate()} disabled={send.isPending || look.too_many || look.recipients === 0} className={primary}>
                <Send className="h-4 w-4" />{" "}
                {send.isPending ? "Starting…" : `Send ${look.recipients === 1 ? "1 email" : `${look.recipients} emails`}`}
              </button>
            </>
          ) : (
            <button onClick={onClose} className={quiet}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
