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

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  owner_id: string | null;
  start_date: string | null;
  target_date: string | null;
  color: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  color?: string;
  start_date?: string;
  target_date?: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  target_date?: string | null;
  is_archived?: boolean;
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
