/**
 * Team chat — people talking to people. Always on the hub: a channel only
 * means something on the copy everyone else reads, so there is no local twin
 * and no `source` switch here.
 */
import { apiClient } from "@/api/client";

const T = "/hub/api/team";

export type ChannelKind = "global" | "project" | "group" | "dm";

export interface Person {
  id: string;
  email: string;
  display_name: string;
  /** The hub's own id for the signed-in person differs from the desktop's; this says which row is you. */
  is_me?: boolean;
}

export interface TeamChannel {
  id: string;
  kind: ChannelKind;
  name: string;
  project_id: string | null;
  members: Person[];
  unread: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_by: string | null;
}

export interface TeamAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
}

export interface TeamRef {
  kind: string;
  id?: string;
  label: string;
  route?: string;
  url?: string;
}

export interface TeamMessage {
  id: string;
  channel_id: string;
  author: Person | null;
  mine: boolean;
  content: string;
  attachments: TeamAttachment[];
  refs: TeamRef[];
  mentions: string[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface TeamUnread {
  total: number;
  channels: Record<string, number>;
}

export async function listPeople(): Promise<Person[]> {
  return (await apiClient.get<Person[]>(`${T}/people`)).data;
}

export async function listChannels(): Promise<TeamChannel[]> {
  return (await apiClient.get<TeamChannel[]>(`${T}/channels`)).data;
}

export async function getTeamUnread(): Promise<TeamUnread> {
  return (await apiClient.get<TeamUnread>(`${T}/unread`)).data;
}

export async function getChannel(id: string): Promise<TeamChannel> {
  return (await apiClient.get<TeamChannel>(`${T}/channels/${id}`)).data;
}

export async function createGroup(name: string, memberIds: string[]): Promise<TeamChannel> {
  return (await apiClient.post<TeamChannel>(`${T}/channels`, { kind: "group", name, member_ids: memberIds })).data;
}

export async function openDirectMessage(personId: string): Promise<TeamChannel> {
  return (await apiClient.post<TeamChannel>(`${T}/channels`, { kind: "dm", member_ids: [personId] })).data;
}

export async function ensureProjectChannel(projectId: string): Promise<TeamChannel> {
  return (await apiClient.post<TeamChannel>(`${T}/channels/project/${projectId}`)).data;
}

export async function updateChannel(
  id: string,
  body: { name?: string; add_member_ids?: string[]; remove_member_ids?: string[] },
): Promise<TeamChannel> {
  return (await apiClient.patch<TeamChannel>(`${T}/channels/${id}`, body)).data;
}

export async function markChannelRead(id: string): Promise<void> {
  await apiClient.post(`${T}/channels/${id}/read`);
}

export async function leaveChannel(id: string): Promise<void> {
  await apiClient.post(`${T}/channels/${id}/leave`);
}

export async function listMessages(
  channelId: string,
  opts: { after?: string; before?: string; limit?: number } = {},
): Promise<TeamMessage[]> {
  return (await apiClient.get<TeamMessage[]>(`${T}/channels/${channelId}/messages`, { params: opts })).data;
}

export async function postMessage(
  channelId: string,
  body: { content: string; attachments?: TeamAttachment[]; refs?: TeamRef[]; mention_ids?: string[] },
): Promise<TeamMessage> {
  return (await apiClient.post<TeamMessage>(`${T}/channels/${channelId}/messages`, body)).data;
}

export async function editMessage(id: string, content: string): Promise<TeamMessage> {
  return (await apiClient.patch<TeamMessage>(`${T}/messages/${id}`, { content })).data;
}

export async function deleteMessage(id: string): Promise<TeamMessage> {
  return (await apiClient.delete<TeamMessage>(`${T}/messages/${id}`)).data;
}

/** The desktop→hub proxy carries JSON only, so the bytes travel base64. */
export async function uploadAttachment(channelId: string, file: File): Promise<TeamAttachment> {
  const data_b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  return (
    await apiClient.post<TeamAttachment>(`${T}/channels/${channelId}/attachments`, {
      filename: file.name,
      mime: file.type || "application/octet-stream",
      data_b64,
    })
  ).data;
}

export async function fetchAttachmentBlob(att: TeamAttachment): Promise<Blob> {
  const r = await apiClient.get(`${T}/files/${encodeURIComponent(att.id)}`, { responseType: "blob" });
  return r.data as Blob;
}

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
