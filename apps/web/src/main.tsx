import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AuthProvider, RequireAuth } from "./auth.tsx";
import { InstanceProvider } from "./instance.tsx";
import { AppLayout, PublicLayout } from "./components/Layout.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { NewAgentPage } from "./pages/NewAgentPage.tsx";
import { ManageAgentPage } from "./pages/ManageAgentPage.tsx";
import { AgentPage } from "./pages/AgentPage.tsx";
import { VersionsPage } from "./pages/VersionsPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { CatalogPage } from "./pages/CatalogPage.tsx";
import { AssistantPage } from "./pages/AssistantPage.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <InstanceProvider>
      <AuthProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<HomePage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="catalogo" element={<CatalogPage />} />
            <Route path="a/:id" element={<AgentPage />} />
            <Route path="a/:id/v/:sel" element={<AgentPage />} />
            <Route path="a/:id/versions" element={<VersionsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route
            path="painel"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="novo" element={<NewAgentPage />} />
            <Route path="assistente" element={<AssistantPage />} />
            <Route path="assistente/:id" element={<AssistantPage />} />
            <Route path=":id" element={<ManageAgentPage />} />
          </Route>
        </Routes>
      </AuthProvider>
      </InstanceProvider>
    </BrowserRouter>
  </StrictMode>,
);
