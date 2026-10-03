import * as React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@v2/components/ui/tooltip";
import { ThemeProvider } from "@v2/design/theme";
import { OctoDataProvider } from "@v2/data/provider";
import { AppRoutes } from "@v2/app";
import { captureOAuthRedirect } from "@v2/auth/session";
import "@v2/styles/globals.css";

// Must run before the first render so the OAuth token from `#token=` is in
// storage before the app's first `GET /api/me`.
captureOAuthRedirect();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Never retry automatically. A backend that is down must not turn into a
      // retry storm; every view surfaces its own error state with a Retry action.
      retry: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <OctoDataProvider>
            <TooltipProvider delayDuration={200}>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </TooltipProvider>
          </OctoDataProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
