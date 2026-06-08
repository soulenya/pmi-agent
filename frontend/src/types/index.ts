// Shared TypeScript types mirroring backend Pydantic schemas

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  meta: PaginationMeta | null;
  error: ApiError | null;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  can_write_regulatory?: boolean;
  onboarding_complete?: boolean;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ── Health ────────────────────────────────────────────────────────────────────

export interface HealthCheck {
  status: "ok" | "degraded";
  timestamp: string;
  checks: {
    database?: { status: string; detail?: string };
    ollama?: { status: string; detail?: string };
    disk?: { status: string; free_gb: number };
  };
}
