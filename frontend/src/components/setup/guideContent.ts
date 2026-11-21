/**
 * What the setup guide says about each connection: what it is, why it is
 * there, what you gain, what it costs and what comes with it. Plain words,
 * written for someone who has never set up an API key.
 *
 * Costs are described by how they are charged and where to cap them, never as
 * figures: every one of these services changes its prices.
 */
import { BRAND } from "@/lib/brand";

export type GuideItemId =
  | "google"
  | "gmail"
  | "ai"
  | "embeddings"
  | "voice"
  | "notifications"
  | "settings";

export interface GuideItem {
  id: GuideItemId;
  /** Completes "Would you like to ..." */
  question: string;
  title: string;
  /** One line under the question in the list. */
  summary: string;
  /** "company": one setting for everyone, set by an administrator on the hub. */
  scope: "you" | "company";
  what: string;
  why: string;
  gain: string[];
  cost: string;
  strings: string[];
}

const G = BRAND.assistantName;

export const GUIDE_ITEMS: GuideItem[] = [
  {
    id: "google",
    question: "connect your Google Workspace",
    title: "Google Workspace",
    summary: "Drive, Calendar, Docs, Sheets, Slides and Contacts",
    scope: "you",
    what: `A sign-in with your work Google account that lets ${G} work with your Drive files, calendar, documents, spreadsheets and contacts, as you.`,
    why: `${G} can only help with what it can see. Without this it can chat, but it cannot find a file, check your calendar or write a document for you.`,
    gain: [
      "Ask about any file or folder you can open in Drive, and get an answer with a link.",
      "See today's meetings and what is due, and have events proposed for your calendar.",
      "Have documents, spreadsheets, slides and forms written for you in your own Drive.",
    ],
    cost: "Nothing extra. It uses the Google Workspace you already pay for.",
    strings: [
      `${G} sees what your Google account can see, no more and no less.`,
      `${G} only edits a file you have named for it to edit; it asks first for anything else.`,
      "You can take the access away at any time from your Google Account, under Security, Third-party connections.",
      "The same sign-in also connects Gmail (next item). There is no way to grant one without the other.",
    ],
  },
  {
    id: "gmail",
    question: "connect Gmail",
    title: "Gmail",
    summary: "Read, search, summarise and draft your email",
    scope: "you",
    what: `Your inbox inside ${BRAND.productName}, and ${G}'s ability to read, search and draft email as you.`,
    why: "Most of what a business needs to follow up on arrives by email. This is what lets the Today page and the morning briefing tell you what needs a reply.",
    gain: [
      "Your inbox in the app, updating as mail arrives, with long threads summarised.",
      `Ask ${G} to find an email, summarise a thread or draft a reply in your voice.`,
      "Invoices that arrive by email can be picked up for filing.",
    ],
    cost: "Nothing extra.",
    strings: [
      `Anything ${G} wants to send waits for your approval first. Mail you write and send yourself goes straight out.`,
      "It comes with the Google Workspace sign-in above: connect that and Gmail is connected.",
      `What ${G} reads is sent to the AI service you choose below so it can answer. Anthropic and OpenAI say they do not train their models on what business accounts send by default. The other services have their own terms: read the terms of the one you choose if that matters to you.`,
    ],
  },
  {
    id: "ai",
    question: `choose the AI that powers ${G}`,
    title: "The AI service",
    summary: "Claude (Anthropic) is recommended; OpenAI, Gemini, Grok and others also work",
    scope: "company",
    what: `${G} does not think by itself: every answer is written by an AI model run by a company such as Anthropic (Claude), OpenAI, Google (Gemini) or xAI (Grok). You open an account with one of them, and paste its key here so ${G} can use it.`,
    why: `This is the one connection ${G} cannot work without. Until a key is saved, ${G} cannot answer anything.`,
    gain: [
      `Everything ${G} does: answering, drafting, summarising, planning, reading documents.`,
      "You choose the service, and you can change it later in Settings.",
    ],
    cost: "Paid by use, on your own account with the AI company: you are charged for the amount of text sent and written, not a flat fee. Light use costs little; long documents and heavy daily use cost more. Anthropic and OpenAI both let you prepay and set a monthly limit, which is worth doing on day one; look for the same with any other.",
    strings: [
      `The bill comes from the AI company, not from ${BRAND.productName}.`,
      "One key serves the whole company here, so everyone's use is on that one bill.",
      "Only Claude can read scanned documents and images in this app; with any other service those cannot be read.",
      "If the service you choose also does search by meaning (OpenAI, Gemini, Mistral), that is set for you on the same key, and the next step is already done.",
    ],
  },
  {
    id: "embeddings",
    question: "turn on search by meaning",
    title: "Search by meaning",
    summary: "Voyage AI is recommended; an OpenAI, Gemini or Mistral key also works",
    scope: "company",
    what: `A second, much smaller AI service that turns text into numbers so ${G} can find things by what they mean, not only by the exact words. The technical name is "embeddings".`,
    why: `It is what lets "the pump supplier decision" find a document that never uses those words.`,
    gain: [
      "The Knowledge Base: upload documents and ask questions answered from them.",
      "Better matching of related emails, tasks and notes.",
    ],
    cost: "Paid by use and small: it is charged by the amount of text indexed, which happens once per document. Voyage gives new accounts a free allowance.",
    strings: [
      "If you chose OpenAI, Gemini or Mistral above, this was set to the same service on the same key when you chose it, and there is no second account. Claude and Grok have no such service, which is why Voyage AI is offered beside them.",
      "Changing this service later means the Knowledge Base has to be indexed again.",
    ],
  },
  {
    id: "voice",
    question: `talk to ${G} and hear the answers`,
    title: "Voice: listening and speaking",
    summary: "Speech-to-text and text-to-speech, both from Google",
    scope: "company",
    what: `Two Google services behind one key: speech-to-text turns what you say into words for ${G}, and text-to-speech reads the answer back aloud.`,
    why: `It is what the microphone button uses, and how ${G} works hands-free on a phone.`,
    gain: [
      "Tap the microphone and talk instead of typing; hear the answer while you do something else.",
      "On a phone, the app opens ready to listen.",
      "Dictate a note instead of typing it.",
    ],
    cost: "Paid by use on your Google Cloud bill, by the minute listened to and the amount of text spoken. Google includes a free amount each month, which light use may never exceed.",
    strings: [
      `The key is made in the Google Cloud Console, in the Google Cloud project your company's ${BRAND.productName} runs in.`,
      "Restrict the key to the two speech services, so it is no use to anyone for anything else.",
      "Everything else works without voice; this is optional.",
    ],
  },
  {
    id: "notifications",
    question: "get notifications on this device",
    title: "Notifications",
    summary: "Mentions, approvals, due tasks and new mail, even when the app is closed",
    scope: "you",
    what: "A message from the app to this phone or computer when something needs you.",
    why: `So you do not have to keep the app open to know that ${G} is waiting for an approval or that something is due.`,
    gain: [
      "A notification when someone mentions you, an approval is waiting, a task falls due or mail arrives.",
      "Tap it to land on the right place.",
    ],
    cost: "Nothing.",
    strings: [
      "It is per device: turn it on once on each phone or computer where you want it.",
      "Your browser will ask for permission. If you say no, you have to allow it again in the browser's site settings.",
      "On an iPhone it only works after you add the app to your Home Screen and open it from there.",
    ],
  },
  {
    id: "settings",
    question: "look through all the settings",
    title: "All settings",
    summary: "Everything above, and the rest, in one place",
    scope: "you",
    what: "The Settings page: every option in the app, including the ones this guide covers.",
    why: "This guide covers what is needed to get going. Settings is where you change any of it later, and where the less common options live.",
    gain: [
      "Your name, time zone and appearance.",
      "Which AI model is used for which kind of work.",
      "Your writing voice, daily briefing and other preferences.",
    ],
    cost: "Nothing.",
    strings: ["Nothing here is urgent. You can come back to this guide at any time from the menu under your name."],
  },
];
