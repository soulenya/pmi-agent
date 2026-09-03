import { apiClient } from "./client";
import type {
  AssignableRole,
  Dependency,
  DependencyKind,
  HeldItem,
  Project,
  ProjectCreate,
  ProjectMember,
  ProjectSpace,
  ProjectUpdate,
  Task,
  TaskCreate,
  TaskComment,
  TaskUpdate,
  Timeline,
} from "@/types/tasks";

// ── Projects ──────────────────────────────────────────────────────────────────

/** Where a project lives. Hub work is never copied down; it is asked for. */
export type Source = "local" | "hub";

// The desktop reaches the hub through its own backend, so the hub credential
// never touches the renderer.
function at(source: Source, path: string): string {
  return source === "hub" ? `/hub/api${path}` : path;
}

export async function listProjects(
  includeArchived = false,
  source: Source = "local",
): Promise<Project[]> {
  const resp = await apiClient.get<Project[]>(at(source, "/projects"), {
    params: { include_archived: includeArchived },
  });
  return resp.data;
}

export async function getProject(id: string): Promise<Project> {
  const resp = await apiClient.get<Project>(`/projects/${id}`);
  return resp.data;
}

export async function getProjectSpace(
  id: string,
  source: Source = "local",
): Promise<ProjectSpace> {
  const resp = await apiClient.get<ProjectSpace>(at(source, `/projects/${id}/space`));
  return resp.data;
}

export async function ensureProjectWorkroom(
  id: string,
  source: Source = "local",
): Promise<{ id: string; title: string; conversation_id: string | null }> {
  const resp = await apiClient.post(at(source, `/projects/${id}/workroom`));
  return resp.data;
}

export async function createProject(
  body: ProjectCreate,
  source: Source = "local",
): Promise<Project> {
  const resp = await apiClient.post<Project>(at(source, "/projects"), body);
  return resp.data;
}

// ── People ────────────────────────────────────────────────────────────────────

/**
 * Adding someone grants a role. It does not grant a way in: they still have to
 * be able to sign in on their own account before the role means anything.
 */
export async function addProjectMember(
  projectId: string,
  email: string,
  role: AssignableRole,
  source: Source = "local",
): Promise<ProjectMember> {
  const resp = await apiClient.post<ProjectMember>(
    at(source, `/projects/${projectId}/members`),
    { email, role },
  );
  return resp.data;
}

export async function updateProjectMember(
  projectId: string,
  userId: string,
  role: AssignableRole,
  source: Source = "local",
): Promise<ProjectMember> {
  const resp = await apiClient.patch<ProjectMember>(
    at(source, `/projects/${projectId}/members/${userId}`),
    { role },
  );
  return resp.data;
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
  source: Source = "local",
): Promise<void> {
  await apiClient.delete(at(source, `/projects/${projectId}/members/${userId}`));
}

export async function updateProject(
  id: string,
  body: ProjectUpdate,
  source: Source = "local",
): Promise<Project> {
  const resp = await apiClient.patch<Project>(at(source, `/projects/${id}`), body);
  return resp.data;
}

export async function deleteProject(
  id: string,
  source: Source = "local",
): Promise<void> {
  await apiClient.delete(at(source, `/projects/${id}`));
}

export async function listHeldItems(
  id: string,
  source: Source = "local",
): Promise<HeldItem[]> {
  const resp = await apiClient.get<HeldItem[]>(at(source, `/projects/${id}/held`));
  return resp.data;
}

export async function releaseHeldItem(
  id: string,
  itemType: string,
  itemId: string,
  note?: string,
  source: Source = "local",
): Promise<void> {
  await apiClient.post(at(source, `/projects/${id}/held/${itemType}/${itemId}/release`), {
    note: note ?? null,
  });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function listTasks(
  params?: {
    project_id?: string;
    status?: string;
  },
  source: Source = "local",
): Promise<Task[]> {
  const resp = await apiClient.get<Task[]>(at(source, "/tasks"), { params });
  return resp.data;
}

export async function createTask(body: TaskCreate, source: Source = "local"): Promise<Task> {
  const resp = await apiClient.post<Task>(at(source, "/tasks"), body);
  return resp.data;
}

export async function updateTask(
  id: string,
  body: TaskUpdate,
  source: Source = "local",
): Promise<Task> {
  const resp = await apiClient.patch<Task>(at(source, `/tasks/${id}`), body);
  return resp.data;
}

export async function deleteTask(id: string, source: Source = "local"): Promise<void> {
  await apiClient.delete(at(source, `/tasks/${id}`));
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

// ── Timeline ────────────────────────────────────────────────────────────

export async function getProjectTimeline(
  projectId: string,
  source: Source = "local",
): Promise<Timeline> {
  const resp = await apiClient.get<Timeline>(
    at(source, `/projects/${projectId}/timeline`),
  );
  return resp.data;
}

export async function addDependency(
  taskId: string,
  predecessorId: string,
  kind: DependencyKind = "FS",
  lagDays = 0,
  source: Source = "local",
): Promise<Dependency> {
  const resp = await apiClient.post<Dependency>(
    at(source, `/tasks/${taskId}/dependencies`),
    { predecessor_id: predecessorId, kind, lag_days: lagDays },
  );
  return resp.data;
}

export async function removeDependency(
  taskId: string,
  predecessorId: string,
  source: Source = "local",
): Promise<void> {
  await apiClient.delete(
    at(source, `/tasks/${taskId}/dependencies/${predecessorId}`),
  );
}

export async function reorderTasks(
  items: { task_id: string; sort_order: number }[],
  source: Source = "local",
): Promise<void> {
  await apiClient.post(at(source, "/tasks/reorder"), { items });
}
