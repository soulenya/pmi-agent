import { apiClient } from "./client";

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

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
