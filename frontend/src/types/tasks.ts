// TypeScript types for Tasks and Projects

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface TaskAttachment {
  id: string;
  name: string;
  url: string;
  source: "upload" | "drive";
  drive_file_id?: string;
}

/** What a task is ABOUT — the task list uses this to open the real thing. */
export type TaskSourceKind =
  | "gmail_thread"
  | "kb_doc"
  | "drive_doc"
  | "regulatory_doc"
  | "meeting"
  | "workroom"
  | "conversation"
  | "google_task"
  | "url";

export interface TaskSourceRef {
  kind: TaskSourceKind;
  id: string;
  label?: string | null;
  url?: string | null;
}

export type ProjectVisibility = "private" | "shared" | "company";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  goal: string;
  status: string;
  visibility: ProjectVisibility;
  owner_id: string | null;
  start_date: string | null;
  target_date: string | null;
  color: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  goal?: string;
  color?: string;
  start_date?: string;
  target_date?: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string | null;
  goal?: string;
  status?: string;
  visibility?: ProjectVisibility;
  color?: string | null;
  target_date?: string | null;
  is_archived?: boolean;
}

export interface ProjectMember {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: "owner" | "editor" | "commenter" | "viewer";
}

export interface ProjectSpace {
  project: Project;
  my_role: ProjectMember["role"];
  workroom: { id: string; title: string; conversation_id: string | null } | null;
  members: ProjectMember[];
  counts: {
    tasks_total: number;
    tasks_open: number;
    items: number;
    journal: number;
    members: number;
  };
}

/** Work the project is holding: made here, and only changeable here until released. */
export interface HeldItem {
  item_type: "task";
  item_id: string;
  label: string | null;
  since: string;
}

export interface Task {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  tags: string[];
  attachments: TaskAttachment[];
  source_conversation_id: string | null;
  source_ref: TaskSourceRef | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCreate {
  title: string;
  description?: string;
  project_id?: string;
  parent_task_id?: string;
  priority?: TaskPriority;
  due_date?: string;
  tags?: string[];
  source_ref?: TaskSourceRef;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  tags?: string[];
  project_id?: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}
