import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
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
import { useThemeStore } from '@/stores/themeStore';
import { pageTransition, springs } from '@/lib/animations';
import { PreviewGallery } from '@/preview/Preview'; // DEV-ONLY

function BootSplash() {
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

/**
 * Page turning: the outlet is keyed by pathname so the old page exits before
 * the new one develops. Nav chrome lives outside and never re-mounts.
 */
function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();

  // New leaf, fresh top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        variants={pageTransition}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}

function PrivateLayout() {
  const { user, initialized } = useAuthStore();

  if (!initialized) {
    return <BootSplash />;
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-lg mx-auto safe-area-inset-top">
        <AnimatedOutlet />
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
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          {import.meta.env.DEV && <Route path="/preview" element={<PreviewGallery />} />}
          <Route element={<PrivateLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/train" element={<Workout />} />
            <Route path="/nutrition" element={<Nutrition />} />
            <Route path="/train/program" element={<Splits />} />
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
