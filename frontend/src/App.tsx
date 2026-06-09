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
import { AssistantPage } from "@/pages/AssistantPage";
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
import { CalendarPage } from "@/pages/CalendarPage";
import GoogleIntegrationPage from "@/pages/GoogleIntegrationPage";
import { GeneratedFilesPage } from "@/pages/GeneratedFilesPage";
import InvestorPage from "@/pages/InvestorPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
            <Route index element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
            <Route path="chat" element={<ErrorBoundary><ChatPage /></ErrorBoundary>} />
            <Route path="chat/:conversationId" element={<ErrorBoundary><ChatPage /></ErrorBoundary>} />
            <Route path="approvals" element={<ErrorBoundary><ApprovalsPage /></ErrorBoundary>} />
            <Route path="assistant" element={<ErrorBoundary><AssistantPage /></ErrorBoundary>} />
            <Route path="documents" element={<ErrorBoundary><DocumentsPage /></ErrorBoundary>} />
            <Route path="search" element={<ErrorBoundary><SearchPage /></ErrorBoundary>} />
            <Route path="tasks" element={<ErrorBoundary><TasksPage /></ErrorBoundary>} />
            <Route path="regulatory" element={<ErrorBoundary><RegulatoryPage /></ErrorBoundary>} />
            <Route path="notifications" element={<ErrorBoundary><NotificationsPage /></ErrorBoundary>} />
            <Route path="research" element={<ErrorBoundary><ResearchPage /></ErrorBoundary>} />
            <Route path="projects" element={<ErrorBoundary><ProjectsPage /></ErrorBoundary>} />
            <Route path="projects/:id" element={<ErrorBoundary><ProjectDetailPage /></ErrorBoundary>} />
            <Route path="settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
            <Route path="meetings" element={<ErrorBoundary><MeetingsPage /></ErrorBoundary>} />
            <Route path="emails" element={<ErrorBoundary><EmailsPage /></ErrorBoundary>} />
            <Route path="audit" element={<ErrorBoundary><AuditPage /></ErrorBoundary>} />
            <Route path="users" element={<ErrorBoundary><UsersPage /></ErrorBoundary>} />
            <Route path="calendar" element={<ErrorBoundary><CalendarPage /></ErrorBoundary>} />
            <Route path="google" element={<ErrorBoundary><GoogleIntegrationPage /></ErrorBoundary>} />
            <Route path="files" element={<ErrorBoundary><GeneratedFilesPage /></ErrorBoundary>} />
            <Route path="investor" element={<ErrorBoundary><InvestorPage /></ErrorBoundary>} />
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
