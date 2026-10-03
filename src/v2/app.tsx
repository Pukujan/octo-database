import * as React from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "@v2/components/layout/app-shell";
import { ActiveWorkspaceProvider } from "@v2/data/workspace-context";
import OverviewPage from "@v2/pages/overview";
import StoragePage from "@v2/pages/storage";
import FilesPage from "@v2/pages/files";
import GalleryPage from "@v2/pages/gallery";
import OperationsPage from "@v2/pages/operations";
import AccessPage from "@v2/pages/access";
import FleetPage from "@v2/pages/fleet";
import SharePage from "@v2/pages/share";
import NotFoundPage from "@v2/pages/not-found";

/** Scopes workspace state to the authenticated shell only. */
function WorkspaceScope({ children }: { children: React.ReactNode }) {
  return <ActiveWorkspaceProvider>{children}</ActiveWorkspaceProvider>;
}

export function AppRoutes() {
  return (
    <Routes>
      {/* Standalone public viewer: no session, no workspace switcher, no admin surface. */}
      <Route path="/share/:token" element={<SharePage />} />

      <Route
        element={
          <WorkspaceScope>
            <AppShell />
          </WorkspaceScope>
        }
      >
        <Route path="/" element={<OverviewPage />} />
        <Route path="/storage" element={<StoragePage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/operations" element={<OperationsPage />} />
        <Route path="/access" element={<AccessPage />} />
        <Route path="/fleet" element={<FleetPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
