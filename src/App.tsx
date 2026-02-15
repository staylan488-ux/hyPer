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
import { springs } from '@/lib/animations';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuthStore();

  if (!initialized) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-5 bg-[#1A1A1A]"
        style={{ backgroundImage: 'radial-gradient(circle at 50% 24%, rgba(196, 164, 132, 0.03), transparent 58%)' }}
      >
        <motion.div
          className="w-full max-w-sm rounded-[28px] border border-white/[0.03] bg-[#242424] px-6 py-8 text-center"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springs.smooth}
        >
          <motion.p
            className="text-[10px] tracking-[0.32em] text-[#6B6B6B] mb-5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.smooth}
          >
            hyPer
          </motion.p>
          <motion.div
            className="h-px bg-[#C4A484] mb-5"
            initial={{ scaleX: 0, opacity: 0.2 }}
            animate={{ scaleX: [0, 1, 1], opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.2, ease: 'easeInOut', repeat: Infinity }}
          />
          <p className="text-[10px] tracking-[0.18em] uppercase text-[#9A9A9A]">Preparing your dashboard</p>
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
      <main className="max-w-lg mx-auto">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

function App() {
  const { initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <BrowserRouter>
      <Routes>
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
          path="/workout"
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
          path="/splits"
          element={
            <PrivateRoute>
              <AppLayout>
                <Splits />
              </AppLayout>
            </PrivateRoute>
          }
        />
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
