import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ChatPage } from "@/pages/ChatPage";
import { ApprovalsPage } from "@/pages/ApprovalsPage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { SearchPage } from "@/pages/SearchPage";
import { TasksPage } from "@/pages/TasksPage";
import { RegulatoryPage } from "@/pages/RegulatoryPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { ResearchPage } from "@/pages/ResearchPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { MeetingsPage } from "@/pages/MeetingsPage";
import { EmailsPage } from "@/pages/EmailsPage";
import { AuditPage } from "@/pages/AuditPage";
import { UsersPage } from "@/pages/UsersPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { useSystemThemeSync, type ThemeValue } from "@/hooks/useTheme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function ThemedApp() {
  const [theme] = useState<ThemeValue>(() => {
    try { return (localStorage.getItem("pmi-theme") as ThemeValue) || "system"; }
    catch { return "system"; }
  });
  useSystemThemeSync(theme);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="chat/:conversationId" element={<ChatPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="regulatory" element={<RegulatoryPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="research" element={<ResearchPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="meetings" element={<MeetingsPage />} />
            <Route path="emails" element={<EmailsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemedApp />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
