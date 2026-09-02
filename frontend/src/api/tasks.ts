import { apiClient } from "./client";
import type {
  HeldItem,
  Project,
  ProjectCreate,
  ProjectSpace,
  ProjectUpdate,
  Task,
  TaskCreate,
  TaskComment,
  TaskUpdate,
} from "@/types/tasks";

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(includeArchived = false): Promise<Project[]> {
  const resp = await apiClient.get<Project[]>("/projects", {
    params: { include_archived: includeArchived },
  });
  return resp.data;
}

export async function getProject(id: string): Promise<Project> {
  const resp = await apiClient.get<Project>(`/projects/${id}`);
  return resp.data;
}

export async function getProjectSpace(id: string): Promise<ProjectSpace> {
  const resp = await apiClient.get<ProjectSpace>(`/projects/${id}/space`);
  return resp.data;
}

export async function ensureProjectWorkroom(
  id: string,
): Promise<{ id: string; title: string; conversation_id: string | null }> {
  const resp = await apiClient.post(`/projects/${id}/workroom`);
  return resp.data;
}

export async function createProject(body: ProjectCreate): Promise<Project> {
  const resp = await apiClient.post<Project>("/projects", body);
  return resp.data;
}

export async function updateProject(id: string, body: ProjectUpdate): Promise<Project> {
  const resp = await apiClient.patch<Project>(`/projects/${id}`, body);
  return resp.data;
}

export async function listHeldItems(id: string): Promise<HeldItem[]> {
  const resp = await apiClient.get<HeldItem[]>(`/projects/${id}/held`);
  return resp.data;
}

export async function releaseHeldItem(
  id: string,
  itemType: string,
  itemId: string,
  note?: string,
): Promise<void> {
  await apiClient.post(`/projects/${id}/held/${itemType}/${itemId}/release`, {
    note: note ?? null,
  });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function listTasks(params?: {
  project_id?: string;
  status?: string;
}): Promise<Task[]> {
  const resp = await apiClient.get<Task[]>("/tasks", { params });
  return resp.data;
}

export async function createTask(body: TaskCreate): Promise<Task> {
  const resp = await apiClient.post<Task>("/tasks", body);
  return resp.data;
}

export async function updateTask(id: string, body: TaskUpdate): Promise<Task> {
  const resp = await apiClient.patch<Task>(`/tasks/${id}`, body);
  return resp.data;
}

export async function deleteTask(id: string): Promise<void> {
  await apiClient.delete(`/tasks/${id}`);
}

export async function listTaskComments(taskId: string): Promise<TaskComment[]> {
  const resp = await apiClient.get<TaskComment[]>(`/tasks/${taskId}/comments`);
  return resp.data;
}

export async function addTaskComment(
  taskId: string,
  content: string
): Promise<TaskComment> {
  const resp = await apiClient.post<TaskComment>(`/tasks/${taskId}/comments`, {
    content,
  });
  return resp.data;
}

export async function addTaskAttachment(
  taskId: string,
  body: { name: string; url: string; source?: "upload" | "drive"; drive_file_id?: string }
): Promise<Task> {
  const resp = await apiClient.post<Task>(`/tasks/${taskId}/attachments`, body);
  return resp.data;
}

export async function removeTaskAttachment(
  taskId: string,
  attachmentId: string
): Promise<Task> {
  const resp = await apiClient.delete<Task>(`/tasks/${taskId}/attachments/${attachmentId}`);
  return resp.data;
}
