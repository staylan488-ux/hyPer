import { useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useOutlet } from 'react-router-dom';
import { MotionConfig, motion } from 'motion/react';
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
import { useNativeHealthSync } from '@/hooks/useNativeHealthSync';
import { useWhoopForegroundSync } from '@/hooks/useWhoopForegroundSync';
import { useNativeAuthCallback } from '@/hooks/useNativeAuthCallback';
import { useAppViewport } from '@/hooks/useAppViewport';
import { bindRouteScroll } from '@/lib/routeScroll';

function BootSplash() {
  return (
    <div className="material-foundation min-h-screen flex flex-col items-center justify-center px-6">
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

/**
 * Tab changes preserve reading position and appear immediately. Never transform
 * this ancestor: workout controls and native run overlays use viewport-fixed
 * positioning, which a transformed ancestor would capture.
 */
function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const viewport = document.querySelector<HTMLElement>('[data-app-scroll-viewport]');
    if (viewport) return bindRouteScroll(viewport, location.pathname, positions.current, {
      navigation: viewport.parentElement ?? viewport,
      history: window,
    });
  }, [location.pathname]);

  return <div key={location.pathname} data-route-content>{outlet}</div>;
}

function PrivateLayout() {
  const { user, initialized } = useAuthStore();
  useAppViewport();

  if (!initialized) {
    return <BootSplash />;
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <div className="app-viewport">
      <main
        data-app-scroll-viewport
        className="app-scroll-viewport"
      >
        <AnimatedOutlet />
      </main>
      <BottomNav />
    </div>
  );
}

function App() {
  const { initialize, user } = useAuthStore();
  const initializeTheme = useThemeStore((state) => state.initializeTheme);

  useNativeHealthSync(user?.id);
  useWhoopForegroundSync(user?.id);
  useNativeAuthCallback();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          {import.meta.env.DEV && <Route path="/preview" element={<PreviewGallery />} />}
          {import.meta.env.DEV && <Route path="/sandbox" element={<Navigate to="/" replace />} />}
          <Route element={<PrivateLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/train" element={<Workout />} />
            <Route path="/nutrition" element={<Nutrition />} />
            <Route path="/train/program" element={<Splits />} />
            <Route path="/train/run" element={<RunTracker />} />
            <Route path="/train/templates" element={<Navigate to="/train/program" replace />} />
            <Route path="/workout" element={<Navigate to="/train" replace />} />
            <Route path="/splits" element={<Navigate to="/train/program" replace />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/history" element={<History />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}

export default App;
