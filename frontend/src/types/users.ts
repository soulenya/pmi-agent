// ── User Management ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface CreateUserRequest {
  email: string;
  display_name: string;
  password: string;
  role: string;
}

export interface UpdateUserRequest {
  display_name?: string;
  is_active?: boolean;
  role?: string;
}
