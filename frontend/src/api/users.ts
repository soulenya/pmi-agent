import { apiClient } from "./client";
import type {
  User,
  CreateUserRequest,
  UpdateUserRequest,
  InviteRequest,
  InviteResult,
} from "@/types/users";

interface ApiResponse<T> {
  data: T;
  ok: boolean;
  meta: unknown;
}

export async function listUsers(): Promise<User[]> {
  const resp = await apiClient.get<ApiResponse<User[]>>("/users");
  return resp.data.data;
}

export async function createUser(body: CreateUserRequest): Promise<User> {
  const resp = await apiClient.post<ApiResponse<User>>("/users", body);
  return resp.data.data;
}

export async function inviteUser(body: InviteRequest): Promise<InviteResult> {
  const resp = await apiClient.post<ApiResponse<InviteResult>>("/users/invite", body);
  return resp.data.data;
}

export async function updateUser(id: string, body: UpdateUserRequest): Promise<User> {
  const resp = await apiClient.patch<ApiResponse<User>>(`/users/${id}`, body);
  return resp.data.data;
}
