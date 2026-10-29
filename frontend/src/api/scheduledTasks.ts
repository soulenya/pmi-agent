import { apiClient } from "./client";

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

/**
 * One step of a routine's procedure: something to do, or a decision with what
 * to do either way. Conditions and actions are plain English — Gerry checks
 * the condition with tools when the routine runs and says which branch she took.
 */
export type RoutineStep =
  | { kind: "do"; text: string }
  | { kind: "if"; condition: string; then: string[]; otherwise: string[] };

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  frequency: ScheduleFrequency;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  minute: number;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_output: string | null;
  // Generated files the last successful run produced (verified on disk).
  last_run_files: string[] | null;
  // Drive / web links the last run produced, gathered from every tool result —
  // not just the ones the model repeated in its closing text.
  last_run_links: string[] | null;
  steps: RoutineStep[] | null;
  conversation_id: string | null;
  workroom_id: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduledTaskInput {
  title: string;
  prompt: string;
  frequency: ScheduleFrequency;
  day_of_week?: number | null;
  day_of_month?: number | null;
  hour: number;
  minute: number;
  enabled?: boolean;
  workroom_id?: string | null;
  steps?: RoutineStep[] | null;
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const r = await apiClient.get<ScheduledTask[]>("/scheduled-tasks");
  return r.data;
}

export async function createScheduledTask(
  body: ScheduledTaskInput,
): Promise<ScheduledTask> {
  const r = await apiClient.post<ScheduledTask>("/scheduled-tasks", body);
  return r.data;
}

export async function updateScheduledTask(
  id: string,
  body: Partial<ScheduledTaskInput>,
): Promise<ScheduledTask> {
  const r = await apiClient.patch<ScheduledTask>(`/scheduled-tasks/${id}`, body);
  return r.data;
}

export async function deleteScheduledTask(id: string): Promise<void> {
  await apiClient.delete(`/scheduled-tasks/${id}`);
}

export async function runScheduledTaskNow(id: string): Promise<ScheduledTask> {
  const r = await apiClient.post<ScheduledTask>(`/scheduled-tasks/${id}/run`);
  return r.data;
}
