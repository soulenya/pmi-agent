import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Suspense, lazy, useState, type ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { SolarSystemPage } from "@/pages/SolarSystemPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useSystemThemeSync, type ThemeValue } from "@/hooks/useTheme";

// Login and the solar system are the first two screens anyone sees, so they
// stay in the entry chunk. Everything else is fetched when its route is first
// opened — without this the canvas and timeline would land in the same 1.8 MB
// bundle as the login form.
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const ChatPage = lazy(() => import("@/pages/ChatPage").then(m => ({ default: m.ChatPage })));
const ApprovalsPage = lazy(() => import("@/pages/ApprovalsPage").then(m => ({ default: m.ApprovalsPage })));
const AssistantPage = lazy(() => import("@/pages/AssistantPage").then(m => ({ default: m.AssistantPage })));
const DocumentsPage = lazy(() => import("@/pages/DocumentsPage").then(m => ({ default: m.DocumentsPage })));
const SearchPage = lazy(() => import("@/pages/SearchPage").then(m => ({ default: m.SearchPage })));
const TasksPage = lazy(() => import("@/pages/TasksPage").then(m => ({ default: m.TasksPage })));
const RegulatoryPage = lazy(() => import("@/pages/RegulatoryPage").then(m => ({ default: m.RegulatoryPage })));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage").then(m => ({ default: m.NotificationsPage })));
const ResearchPage = lazy(() => import("@/pages/ResearchPage").then(m => ({ default: m.ResearchPage })));
const ResearchBrowserPage = lazy(() => import("@/pages/ResearchBrowserPage").then(m => ({ default: m.ResearchBrowserPage })));
const ProjectsPage = lazy(() => import("@/pages/ProjectsPage").then(m => ({ default: m.ProjectsPage })));
const ProjectSpacePage = lazy(() => import("@/pages/ProjectSpacePage").then(m => ({ default: m.ProjectSpacePage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const MeetingsPage = lazy(() => import("@/pages/MeetingsPage").then(m => ({ default: m.MeetingsPage })));
const EmailsPage = lazy(() => import("@/pages/EmailsPage").then(m => ({ default: m.EmailsPage })));
const InboxPage = lazy(() => import("@/pages/InboxPage"));
const ContactsPage = lazy(() => import("@/pages/ContactsPage").then(m => ({ default: m.ContactsPage })));
const BackupsPage = lazy(() => import("@/pages/BackupsPage").then(m => ({ default: m.BackupsPage })));
const AuditPage = lazy(() => import("@/pages/AuditPage").then(m => ({ default: m.AuditPage })));
const UsersPage = lazy(() => import("@/pages/UsersPage").then(m => ({ default: m.UsersPage })));
const ProjectDetailPage = lazy(() => import("@/pages/ProjectDetailPage").then(m => ({ default: m.ProjectDetailPage })));
const CalendarPage = lazy(() => import("@/pages/CalendarPage").then(m => ({ default: m.CalendarPage })));
const GoogleIntegrationPage = lazy(() => import("@/pages/GoogleIntegrationPage"));
const OdooIntegrationPage = lazy(() => import("@/pages/OdooIntegrationPage"));
const GeneratedFilesPage = lazy(() => import("@/pages/GeneratedFilesPage").then(m => ({ default: m.GeneratedFilesPage })));
const ScheduledTasksPage = lazy(() => import("@/pages/ScheduledTasksPage").then(m => ({ default: m.ScheduledTasksPage })));
const InvestorPage = lazy(() => import("@/pages/InvestorPage"));
const AgentsPage = lazy(() => import("@/pages/AgentsPage").then(m => ({ default: m.AgentsPage })));
const WorkroomsPage = lazy(() => import("@/pages/WorkroomsPage").then(m => ({ default: m.WorkroomsPage })));
const BudgetsPage = lazy(() => import("@/pages/BudgetsPage").then(m => ({ default: m.BudgetsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/** Error boundary + lazy-chunk fallback, applied to every route element. */
function Page({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex h-full min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

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
            <Route index element={<Page><SolarSystemPage /></Page>} />
            <Route path="gerry" element={<Page><SolarSystemPage /></Page>} />
            <Route path="planet/:planetId" element={<Page><SolarSystemPage /></Page>} />
            <Route path="dashboard" element={<Page><DashboardPage /></Page>} />
            <Route path="agents" element={<Page><AgentsPage /></Page>} />
            <Route path="chat" element={<Page><ChatPage /></Page>} />
            <Route path="chat/:conversationId" element={<Page><ChatPage /></Page>} />
            <Route path="approvals" element={<Page><ApprovalsPage /></Page>} />
            <Route path="assistant" element={<Page><AssistantPage /></Page>} />
            <Route path="documents" element={<Page><DocumentsPage /></Page>} />
            <Route path="search" element={<Page><SearchPage /></Page>} />
            <Route path="tasks" element={<Page><TasksPage /></Page>} />
            <Route path="scheduled-tasks" element={<Page><ScheduledTasksPage /></Page>} />
            <Route path="regulatory" element={<Page><RegulatoryPage /></Page>} />
            <Route path="notifications" element={<Page><NotificationsPage /></Page>} />
            <Route path="research" element={<Page><ResearchPage /></Page>} />
            <Route path="browser" element={<Page><ResearchBrowserPage /></Page>} />
            <Route path="projects" element={<Page><ProjectsPage /></Page>} />
            <Route path="projects/:id" element={<Page><ProjectDetailPage /></Page>} />
            <Route path="projects/:id/space" element={<Page><ProjectSpacePage /></Page>} />
            <Route path="projects/:id/space/:tab" element={<Page><ProjectSpacePage /></Page>} />
            {/* The same space, rendered against the hub's copy rather than this one's. */}
            <Route path="hub/projects/:id/space" element={<Page><ProjectSpacePage source="hub" /></Page>} />
            <Route path="hub/projects/:id/space/:tab" element={<Page><ProjectSpacePage source="hub" /></Page>} />
            <Route path="settings" element={<Page><SettingsPage /></Page>} />
            <Route path="meetings" element={<Page><MeetingsPage /></Page>} />
            <Route path="emails" element={<Page><EmailsPage /></Page>} />
            <Route path="inbox" element={<Page><InboxPage /></Page>} />
            <Route path="contacts" element={<Page><ContactsPage /></Page>} />
            <Route path="backups" element={<Page><BackupsPage /></Page>} />
            <Route path="audit" element={<Page><AuditPage /></Page>} />
            <Route path="users" element={<Page><UsersPage /></Page>} />
            <Route path="calendar" element={<Page><CalendarPage /></Page>} />
            <Route path="google" element={<Page><GoogleIntegrationPage /></Page>} />
            <Route path="odoo" element={<Page><OdooIntegrationPage /></Page>} />
            <Route path="files" element={<Page><GeneratedFilesPage /></Page>} />
            <Route path="workrooms" element={<Page><WorkroomsPage /></Page>} />
            <Route path="budgets" element={<Page><BudgetsPage /></Page>} />
            <Route path="investor" element={<Page><InvestorPage /></Page>} />
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
