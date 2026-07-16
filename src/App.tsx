import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useAuthStore } from '@/stores/authStore';
import { BottomNav } from '@/components/shared';
import { AuthForm } from '@/components/auth/AuthForm';
import { Dashboard } from '@/pages/Dashboard';
import { Workout } from '@/pages/Workout';
import { Nutrition } from '@/pages/Nutrition';
import { Splits } from '@/pages/Splits';
import { Settings } from '@/pages/Settings';
import { Analysis } from '@/pages/Analysis';
import { History } from '@/pages/History';
import { RunTracker } from '@/pages/RunTracker';
import { useThemeStore } from '@/stores/themeStore';
import { springs } from '@/lib/animations';
import { PreviewGallery } from '@/preview/Preview'; // DEV-ONLY

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuthStore();

  if (!initialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[var(--color-base)]">
        <motion.div
          className="w-full max-w-sm text-center"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <p className="t-label-sm mb-6">A field journal</p>
          <h1 className="[font-family:var(--font-display)] text-[3.5rem] leading-none font-light tracking-[-0.04em] text-[var(--color-text)]">
            hy<span className="italic text-[var(--color-accent)]">P</span>er
          </h1>
          <motion.div
            className="h-px bg-[var(--color-accent)] mt-7 mx-auto"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], repeat: Infinity, repeatType: 'reverse' }}
            style={{ width: '64px', transformOrigin: 'center' }}
          />
          <p className="mt-7 text-[10px] tracking-[0.24em] uppercase text-[var(--color-muted)]">Preparing your edition</p>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <main className="max-w-lg mx-auto safe-area-inset-top">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

function App() {
  const { initialize } = useAuthStore();
  const initializeTheme = useThemeStore((state) => state.initializeTheme);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  return (
    <BrowserRouter>
      <Routes>
        {import.meta.env.DEV && <Route path="/preview" element={<PreviewGallery />} />}
        {import.meta.env.DEV && <Route path="/sandbox" element={<Navigate to="/" replace />} />}
        <Route
          path="/"
          element={
            <PrivateRoute>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/train"
          element={
            <PrivateRoute>
              <AppLayout>
                <Workout />
              </AppLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/nutrition"
          element={
            <PrivateRoute>
              <AppLayout>
                <Nutrition />
              </AppLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/train/program"
          element={
            <PrivateRoute>
              <AppLayout>
                <Splits />
              </AppLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/train/run"
          element={
            <PrivateRoute>
              <AppLayout>
                <RunTracker />
              </AppLayout>
            </PrivateRoute>
          }
        />
        <Route path="/train/templates" element={<Navigate to="/train/program" replace />} />
        <Route path="/workout" element={<Navigate to="/train" replace />} />
        <Route path="/splits" element={<Navigate to="/train/program" replace />} />
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <AppLayout>
                <Settings />
              </AppLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/analysis"
          element={
            <PrivateRoute>
              <AppLayout>
                <Analysis />
              </AppLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/history"
          element={
            <PrivateRoute>
              <AppLayout>
                <History />
              </AppLayout>
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
