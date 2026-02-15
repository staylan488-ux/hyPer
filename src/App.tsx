import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuthStore();

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[#6B6B6B] text-sm tracking-wider">Loading...</div>
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
