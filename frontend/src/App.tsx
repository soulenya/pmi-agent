import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ChatPage } from "@/pages/ChatPage";
import { ApprovalsPage } from "@/pages/ApprovalsPage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { SearchPage } from "@/pages/SearchPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
              {/* Additional pages added in later sprints */}
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
