/**
 * The company this build is for — from brand/brand.json via the Vite brand
 * plugin. The product is always Little Gerry; only the company changes.
 */

export type FeatureName =
  | "regulatory"
  | "qms_agent"
  | "drive_restrictions"
  | "investor_relations"
  | "budgets"
  | "invoices"
  | "erp"
  | "meetings"
  | "hub";

export interface RawBrand {
  slug: string;
  product_name: string;
  assistant_name: string;
  company_name: string;
  company_short: string;
  company_descriptor: string;
  company_website?: string;
  product?: { name?: string; one_liner?: string };
  domains: string[];
  support_email?: string;
  hub_url?: string;
  features: Record<FeatureName, boolean>;
  erp?: { providers?: string[]; default?: string };
}

const raw: RawBrand = __BRAND__;

const domains = (raw.domains ?? []).map((d) => d.toLowerCase().replace(/^@/, ""));

function signInHint(): string {
  if (!domains.length) return "your company Google account";
  const list = domains.map((d) => `@${d}`);
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
  return `a ${joined} account`;
}

export const BRAND = {
  slug: raw.slug,
  productName: raw.product_name,
  assistantName: raw.assistant_name,
  companyName: raw.company_name,
  companyShort: raw.company_short,
  companyDescriptor: raw.company_descriptor,
  companyWebsite: raw.company_website ?? "",
  /** Flagship product, when the company has one ("" otherwise). */
  flagship: raw.product?.name ?? "",
  domains,
  /** "a @x.com or @y.com account" — matches the backend's sign_in_hint. */
  signInHint: signInHint(),
  supportEmail: raw.support_email ?? "",
  hubUrl: raw.hub_url ?? "",
  features: raw.features,
  erpProviders: raw.erp?.providers ?? [],
  erpDefault: raw.erp?.default ?? "none",
  isPmi: raw.slug === "littlegerry",
} as const;

export function hasFeature(name: FeatureName): boolean {
  return BRAND.features[name] !== false;
}

/** Example address for input placeholders: name@<first company domain>. */
export function exampleEmail(local = "name"): string {
  return `${local}@${domains[0] ?? "example.com"}`;
}

/** An example project/programme name for placeholders — the flagship when there is one. */
export const EXAMPLE_PROGRAM = BRAND.flagship || "Launch";
