import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
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
const TasksPage = lazy(() => import("@/pages/TasksPage").then(m => ({ default: m.TasksPage })));
const RegulatoryPage = lazy(() => import("@/pages/RegulatoryPage").then(m => ({ default: m.RegulatoryPage })));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage").then(m => ({ default: m.NotificationsPage })));
const ResearchPage = lazy(() => import("@/pages/ResearchPage").then(m => ({ default: m.ResearchPage })));
const ResearchBrowserPage = lazy(() => import("@/pages/ResearchBrowserPage").then(m => ({ default: m.ResearchBrowserPage })));
const ProjectsPage = lazy(() => import("@/pages/ProjectsPage").then(m => ({ default: m.ProjectsPage })));
const ProjectSpacePage = lazy(() => import("@/pages/ProjectSpacePage").then(m => ({ default: m.ProjectSpacePage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const MeetingsPage = lazy(() => import("@/pages/MeetingsPage").then(m => ({ default: m.MeetingsPage })));
const InboxPage = lazy(() => import("@/pages/InboxPage"));
const ContactsPage = lazy(() => import("@/pages/ContactsPage").then(m => ({ default: m.ContactsPage })));
const AuditPage = lazy(() => import("@/pages/AuditPage").then(m => ({ default: m.AuditPage })));
const UsersPage = lazy(() => import("@/pages/UsersPage").then(m => ({ default: m.UsersPage })));
const CalendarPage = lazy(() => import("@/pages/CalendarPage").then(m => ({ default: m.CalendarPage })));
const OdooIntegrationPage = lazy(() => import("@/pages/OdooIntegrationPage"));
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

/** The old project page; the space has held everything it showed since v4.5. */
function ProjectRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/projects/${id}/space`} replace />;
}

/** Semantic search now lives inside the Knowledge Base; keep ?q= when arriving. */
function SearchRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("tab", "search");
  return <Navigate to={`/documents?${params.toString()}`} replace />;
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
            <Route path="today" element={<Page><DashboardPage /></Page>} />
            <Route path="agents" element={<Navigate to="/settings?tab=ai" replace />} />
            <Route path="chat" element={<Page><ChatPage /></Page>} />
            <Route path="chat/:conversationId" element={<Page><ChatPage /></Page>} />
            <Route path="hub/chat/:conversationId" element={<Page><ChatPage source="hub" /></Page>} />
            <Route path="approvals" element={<Page><ApprovalsPage /></Page>} />
            <Route path="assistant" element={<Page><AssistantPage /></Page>} />
            <Route path="documents" element={<Page><DocumentsPage /></Page>} />
            <Route path="search" element={<SearchRedirect />} />
            <Route path="tasks" element={<Page><TasksPage /></Page>} />
            <Route path="scheduled-tasks" element={<Navigate to="/tasks?tab=routines" replace />} />
            <Route path="regulatory" element={<Page><RegulatoryPage /></Page>} />
            <Route path="notifications" element={<Page><NotificationsPage /></Page>} />
            <Route path="research" element={<Page><ResearchPage /></Page>} />
            <Route path="browser" element={<Page><ResearchBrowserPage /></Page>} />
            <Route path="projects" element={<Page><ProjectsPage /></Page>} />
            <Route path="projects/portfolio" element={<Navigate to="/projects?view=graph" replace />} />
            <Route path="projects/:id" element={<ProjectRedirect />} />
            <Route path="projects/:id/space" element={<Page><ProjectSpacePage /></Page>} />
            <Route path="projects/:id/space/:tab" element={<Page><ProjectSpacePage /></Page>} />
            {/* The same space, rendered against the hub's copy rather than this one's. */}
            <Route path="hub/projects/:id/space" element={<Page><ProjectSpacePage source="hub" /></Page>} />
            <Route path="hub/projects/:id/space/:tab" element={<Page><ProjectSpacePage source="hub" /></Page>} />
            <Route path="settings" element={<Page><SettingsPage /></Page>} />
            <Route path="meetings" element={<Page><MeetingsPage /></Page>} />
            <Route path="emails" element={<Navigate to="/inbox?view=drafts" replace />} />
            <Route path="inbox" element={<Page><InboxPage /></Page>} />
            <Route path="contacts" element={<Page><ContactsPage /></Page>} />
            <Route path="backups" element={<Navigate to="/settings?tab=system" replace />} />
            <Route path="audit" element={<Page><AuditPage /></Page>} />
            <Route path="users" element={<Page><UsersPage /></Page>} />
            <Route path="calendar" element={<Page><CalendarPage /></Page>} />
            <Route path="google" element={<Navigate to="/settings?tab=connections" replace />} />
            <Route path="odoo" element={<Page><OdooIntegrationPage /></Page>} />
            <Route path="files" element={<Navigate to="/documents?tab=made-by-gerry" replace />} />
            <Route path="workrooms" element={<Navigate to="/projects?view=rooms" replace />} />
            <Route path="budgets" element={<Page><BudgetsPage /></Page>} />
            <Route path="investor" element={<Navigate to="/regulatory" replace />} />
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
