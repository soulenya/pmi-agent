import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

/**
 * The company, read once at build time from brand/brand.json at the repo
 * root — the same file the backend reads. Missing file = PMI (the defaults
 * below match backend/brand.py so a bare checkout still builds PMI's app).
 */
const PMI_BRAND = {
  slug: "littlegerry",
  product_name: "Little Gerry",
  assistant_name: "Gerry",
  company_name: "Precisian Medical Instruments",
  company_short: "PMI",
  company_descriptor: "a medical device startup",
  company_website: "https://www.precisianmedical.com",
  product: { name: "VACTOR" },
  domains: ["pmi-llc.com", "precisianmedical.com"],
  support_email: "morganjkeane@pmi-llc.com",
  hub_url: "https://hub.precisianmedical.com",
  features: {
    regulatory: true,
    qms_agent: true,
    drive_restrictions: true,
    investor_relations: true,
    budgets: true,
    invoices: true,
    erp: true,
    meetings: true,
    hub: true,
  },
  erp: { providers: ["odoo"], default: "odoo" },
};

function loadBrand() {
  // BRAND_FILE mirrors the backend's override, for building a test brand.
  const file = process.env.BRAND_FILE || path.resolve(__dirname, "../brand/brand.json");
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    /* no brand file — PMI */
  }
  const features = { ...PMI_BRAND.features, ...((raw.features as object) ?? {}) };
  const product = "product" in raw ? ((raw.product as object) ?? {}) : PMI_BRAND.product;
  const erp = "erp" in raw ? ((raw.erp as object) ?? {}) : PMI_BRAND.erp;
  return { ...PMI_BRAND, ...raw, features, product, erp };
}

function brandPlugin(): Plugin {
  const brand = loadBrand();
  let outDir = path.resolve(__dirname, "dist");
  return {
    name: "little-gerry-brand",
    config: () => ({ define: { __BRAND__: JSON.stringify(brand) } }),
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    // public/manifest.webmanifest is copied verbatim; stamp the company into
    // the built copy so the installed app describes the right company.
    closeBundle() {
      const out = path.join(outDir, "manifest.webmanifest");
      if (!fs.existsSync(out)) return;
      const manifest = JSON.parse(fs.readFileSync(out, "utf-8"));
      const owner = `${brand.company_name}${/s$/i.test(brand.company_name) ? "'" : "'s"}`;
      manifest.description = `${owner} assistant: your projects, tasks, Team and ${brand.assistant_name}, on the hub.`;
      fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
    },
  };
}

export default defineConfig({
  plugins: [react(), brandPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
