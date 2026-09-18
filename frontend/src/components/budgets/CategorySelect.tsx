/**
 * A category picker for the itemised lists: the budget's categories, plus a
 * way to add one without leaving the row. A new name goes onto the sheet's
 * Categories tab first, so the dropdown and the sheet never disagree.
 */
import { useState } from "react";

import { addBudgetCategory, type BudgetCategory } from "@/api/budgets";
import type { Source } from "@/api/tasks";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

const NEW = "__new__";

export function CategorySelect({
  budgetId,
  categories,
  value,
  onChange,
  onAdded,
  source = "local",
  canAdd = true,
  className,
  allowBlank = true,
}: {
  budgetId: string;
  categories: BudgetCategory[];
  value: string;
  onChange: (name: string) => void;
  /** Called after a new category is on the sheet, so the parent refetches. */
  onAdded?: () => void;
  source?: Source;
  canAdd?: boolean;
  className?: string;
  allowBlank?: boolean;
}) {
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState(false);
  const names = categories.map((c) => c.name);
  // A value the sheet does not know (typed in Sheets, or an older row) still shows.
  const options = value && !names.includes(value) ? [...names, value] : names;

  const addNew = async () => {
    const name = window.prompt("New category name")?.trim();
    if (!name) return;
    if (names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      onChange(names.find((n) => n.toLowerCase() === name.toLowerCase())!);
      return;
    }
    setBusy(true);
    try {
      await addBudgetCategory(budgetId, { name }, source);
      onChange(name);
      onAdded?.();
      push("success", `Category "${name}" added to the sheet.`);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", typeof detail === "string" ? detail : "Couldn't add the category.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      value={value}
      disabled={busy}
      onChange={(e) => {
        if (e.target.value === NEW) void addNew();
        else onChange(e.target.value);
      }}
      className={cn("rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-60", className)}
      title="Category"
    >
      {allowBlank && <option value="">{options.length ? "Category…" : "No categories yet"}</option>}
      {options.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      {canAdd && <option value={NEW}>＋ New category…</option>}
    </select>
  );
}
