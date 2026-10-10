import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/lib/theme';
import { SessionProvider, useSession } from '@/lib/session';
import { WorkspaceProvider } from '@/lib/workspace';
import { OctoProvider } from '@/lib/octo';
import LoginPage from '@/pages/LoginPage';
import Shell from '@/components/Shell';
import PublicShare from '@/pages/PublicShare';

/** The session decides which screen the root path shows. */
function Root() {
  const { principal, ready } = useSession();
  if (!ready) return null;
  if (!principal) return <LoginPage />;
  return (
    <WorkspaceProvider>
      <OctoProvider>
        <Shell />
      </OctoProvider>
    </WorkspaceProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/share/:token" element={<PublicShare />} />
            <Route path="*" element={<Root />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </ThemeProvider>
  );
}
