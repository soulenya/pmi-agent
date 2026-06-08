import { apiClient } from "./client";

// ── Feedback (bug reports / feature requests) ───────────────────────────────

export type FeedbackCategory = "bug" | "feature";

export interface Feedback {
  id: string;
  user_id: string;
  category: FeedbackCategory;
  message: string;
  status: string;
  created_at: string;
}

export async function submitFeedback(
  category: FeedbackCategory,
  message: string,
): Promise<Feedback> {
  const { data } = await apiClient.post<Feedback>("/feedback", { category, message });
  return data;
}
