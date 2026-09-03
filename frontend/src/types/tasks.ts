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
  visibility?: ProjectVisibility;
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

/** Ownership moves by a different act than sharing, so it is not offered here. */
export type AssignableRole = "viewer" | "commenter" | "editor";

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
  start_date: string | null;
  end_date: string | null;
  progress_pct: number;
  is_milestone: boolean;
  sort_order: number;
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
  start_date?: string;
  end_date?: string;
  is_milestone?: boolean;
  tags?: string[];
  source_ref?: TaskSourceRef;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  progress_pct?: number;
  is_milestone?: boolean;
  sort_order?: number;
  tags?: string[];
  project_id?: string | null;
}

// ── Timeline ────────────────────────────────────────────────────────────

/** Finish-to-start, start-to-start, finish-to-finish, start-to-finish. */
export type DependencyKind = "FS" | "SS" | "FF" | "SF";

export interface Dependency {
  id: string;
  predecessor_id: string;
  successor_id: string;
  kind: DependencyKind;
  lag_days: number;
}

export interface ScheduledTask {
  task_id: string;
  early_start: string;
  early_finish: string;
  late_start: string;
  late_finish: string;
  slack_days: number;
  is_critical: boolean;
  is_late: boolean;
  /** The open gate this task is scheduled to start ahead of. */
  blocked_by_gate: string | null;
}

/** A milestone in another project that this one is waiting on. */
export interface Gate {
  link_id: string;
  from_project_id: string;
  from_project_name: string;
  gate_task_id: string | null;
  gate_task_title: string;
  opens_on: string | null;
  status: ProjectLinkStatus;
  note: string;
}

export interface Timeline {
  project_id: string;
  tasks: Task[];
  dependencies: Dependency[];
  schedule: ScheduledTask[];
  gates: Gate[];
  my_role: string;
}

// ── Project links ─────────────────────────────────────────────────────────────

export type ProjectLinkKind = "depends_on" | "gates" | "parallel" | "subproject_of";
export type ProjectLinkStatus = "open" | "satisfied" | "waived";

export interface ProjectLink {
  id: string;
  from_project_id: string;
  to_project_id: string;
  kind: ProjectLinkKind;
  gate_task_id: string | null;
  gate_task_title: string;
  note: string;
  status: ProjectLinkStatus;
  satisfied_at: string | null;
  /** Empty when the viewer cannot see the project on the other end. */
  other_project_id: string | null;
  other_project_name: string;
  other_project_status: string;
  other_visible: boolean;
  /** "out" when this project is the `from` end of the sentence. */
  direction: "out" | "in";
  created_at: string;
}

export interface ProjectLinkCreate {
  to_project_id: string;
  kind: ProjectLinkKind;
  gate_task_id?: string | null;
  note?: string;
}

export interface ProjectLinkUpdate {
  kind?: ProjectLinkKind;
  gate_task_id?: string | null;
  note?: string;
  status?: ProjectLinkStatus;
}

export interface PortfolioNode {
  id: string;
  name: string;
  status: string;
  color: string | null;
  goal: string;
  open_tasks: number;
  late_tasks: number;
  open_gates: number;
  next_milestone: string;
  next_milestone_date: string | null;
}

export interface PortfolioEdge {
  id: string;
  from_project_id: string;
  to_project_id: string;
  kind: ProjectLinkKind;
  status: ProjectLinkStatus;
  note: string;
  /** One end is a project this viewer cannot see. */
  dangling: boolean;
}

export interface Portfolio {
  projects: PortfolioNode[];
  links: PortfolioEdge[];
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}
