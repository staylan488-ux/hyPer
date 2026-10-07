import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider,
  Route,
  Navigate,
  useLocation,
  useOutlet,
} from 'react-router-dom';
import { motion } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { BottomNav, ChromeDefs, LightField, RouteErrorScreen } from '@/components/shared';
import { useLitSurface } from '@/hooks/useLitSurface';
import { FxLayer } from '@/components/fx/FxLayer';
import { AuthForm } from '@/components/auth/AuthForm';
import { Button } from '@/components/shared/Button';
import { Dashboard } from '@/pages/Dashboard';
import { Workout } from '@/pages/Workout';
import { Nutrition } from '@/pages/Nutrition';
import { useThemeStore } from '@/stores/themeStore';
import { springs } from '@/lib/animations';
import { PreviewGallery } from '@/preview/Preview'; // DEV-ONLY
import { IntroPreview } from '@/preview/IntroPreview'; // DEV-ONLY
import { GlassPreview } from '@/preview/GlassPreview'; // DEV-ONLY
import { useNativeHealthSync } from '@/hooks/useNativeHealthSync';
import { useWhoopForegroundSync } from '@/hooks/useWhoopForegroundSync';
import { useNativeAuthCallback } from '@/hooks/useNativeAuthCallback';
import { useAppViewport } from '@/hooks/useAppViewport';
import { NativeGlassSurfaces, probeGlassSurfaces } from '@/lib/nativeGlassSurfaces';
import { isNativeIOS } from '@/lib/nativeBridge';
import { bindRouteScroll } from '@/lib/routeScroll';
import { watchRestTimerSignOut, watchRestTimerWorkoutEnd } from '@/lib/restTimerWorkoutGuard';
import { authScreen } from '@/lib/authScreen';
import { reloadOnStaleChunk } from '@/lib/staleChunkReload';

/** `onSignInInstead` marks the offline restore: the saved sign-in is kept and
 * the app opens by itself once the connection returns. */
function BootSplash({ onSignInInstead }: { onSignInInstead?: () => void } = {}) {
  return (
    <div className="material-foundation min-h-screen flex flex-col items-center justify-center px-6">
      <motion.div
        className="w-full max-w-sm text-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.settle}
      >
        <p className="t-label-sm mb-6">A field journal</p>
        <h1 className="[font-family:var(--font-display)] text-[3.5rem] leading-none font-light tracking-[-0.04em] text-[var(--color-text)]">
          hy<span className="italic text-[var(--color-accent)]">P</span>er
        </h1>
        <motion.div
          className="h-px bg-[var(--color-accent)] mt-7 mx-auto"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{
            duration: 1.1,
            ease: [0.16, 1, 0.3, 1],
            repeat: Infinity,
            repeatType: 'reverse',
          }}
          style={{ width: '64px', transformOrigin: 'center' }}
        />
        <p
          className="mt-7 text-[10px] tracking-[0.24em] uppercase text-[var(--color-muted)]"
          role="status"
        >
          {onSignInInstead ? 'Offline, waiting for a connection' : 'Preparing your edition'}
        </p>
        {onSignInInstead && (
          <Button type="button" variant="ghost" size="sm" className="mt-5" onClick={onSignInInstead}>
            Sign in instead
          </Button>
        )}
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
    if (viewport)
      return bindRouteScroll(viewport, location.pathname, positions.current, {
        navigation: viewport.parentElement ?? viewport,
        history: window,
      });
  }, [location.pathname]);

  return (
    <div
      key={location.pathname.startsWith('/settings') ? '/settings' : location.pathname}
      data-route-content
    >
      {outlet}
    </div>
  );
}

function PrivateLayout() {
  const { user, initialized, reconnecting } = useAuthStore();
  // local only: signing in instead never signs out, so the saved session stays
  const [signInInstead, setSignInInstead] = useState(false);
  useAppViewport();
  // The whole app catches the motion light, so chrome anywhere answers tilt.
  const litViewport = useLitSurface<HTMLDivElement>();
  const sessionLive = useAppStore((state) => Boolean(state.currentWorkout && !state.currentWorkout.completed));

  const screen = authScreen({ initialized, user, reconnecting }, signInInstead);
  if (screen === 'boot') {
    return <BootSplash />;
  }

  if (screen === 'offline') {
    return <BootSplash onSignInInstead={() => setSignInInstead(true)} />;
  }

  if (screen === 'sign-in') {
    return <AuthForm />;
  }

  return (
    <div ref={litViewport} className="app-viewport" data-live={sessionLive || undefined}>
      <ChromeDefs />
      <LightField />
      <main data-app-scroll-viewport className="app-scroll-viewport">
        <AnimatedOutlet />
      </main>
      <BottomNav />
      <FxLayer />
    </div>
  );
}

/**
 * Secondary screens load on first visit so launch evaluates less code. Route
 * `lazy` keeps the current screen until the chunk arrives, with no Suspense
 * inside the keyed route container. The three main tabs stay in the entry.
 */
const pageChunk = {
  program: () => import('@/pages/Splits').then((m) => ({ Component: m.Splits })),
  run: () => import('@/pages/RunTracker').then((m) => ({ Component: m.RunTracker })),
  settings: () => import('@/pages/Settings').then((m) => ({ Component: m.Settings })),
  analysis: () => import('@/pages/Analysis').then((m) => ({ Component: m.Analysis })),
  history: () => import('@/pages/History').then((m) => ({ Component: m.History })),
};

/** Opening a screen whose chunk a deploy has replaced reloads the tab once. */
const lazyPage = {
  program: reloadOnStaleChunk(pageChunk.program),
  run: reloadOnStaleChunk(pageChunk.run),
  settings: reloadOnStaleChunk(pageChunk.settings),
  analysis: reloadOnStaleChunk(pageChunk.analysis),
  history: reloadOnStaleChunk(pageChunk.history),
};

/** Web only: fetch the lazy screens once launch has settled so a first visit
 * over the network is still instant. Native reads chunks from local files.
 * Uses the plain loaders: a failed warm-up is silent and never reloads. */
function warmLazyPages() {
  if (Capacitor.isNativePlatform()) return;
  const warm = () => Object.values(pageChunk).forEach((load) => void load().catch(() => {}));
  const timer = window.setTimeout(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 5000 });
    else warm();
  }, 3000);
  return () => window.clearTimeout(timer);
}

/** A cold deep link to a lazy page keeps the shell (splash, sign-in, nav)
 * and leaves only the page area empty until its chunk loads. */
function PageChunkPending() {
  return null;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      {import.meta.env.DEV && (
        <Route path="/preview/you" element={<Navigate to="/settings" replace />} />
      )}
      {import.meta.env.DEV && <Route path="/preview" element={<PreviewGallery />} />}
      {import.meta.env.DEV && <Route path="/preview/intro" element={<IntroPreview />} />}
      {import.meta.env.DEV && <Route path="/preview/glass" element={<GlassPreview />} />}
      {import.meta.env.DEV && <Route path="/preview/sign-in" element={<AuthForm />} />}
      {import.meta.env.DEV && <Route path="/sandbox" element={<Navigate to="/" replace />} />}
      <Route element={<PrivateLayout />}>
        {/* Pathless boundary: a page that throws renders the error screen inside
            the shell, so the bottom nav stays usable. */}
        <Route errorElement={<RouteErrorScreen />} HydrateFallback={PageChunkPending}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/train" element={<Workout />} />
          <Route path="/nutrition" element={<Nutrition />} />
          <Route path="/train/program" lazy={lazyPage.program} />
          <Route path="/train/run" lazy={lazyPage.run} />
          <Route path="/train/templates" element={<Navigate to="/train/program" replace />} />
          <Route path="/workout" element={<Navigate to="/train" replace />} />
          <Route path="/splits" element={<Navigate to="/train/program" replace />} />
          <Route path="/settings/*" lazy={lazyPage.settings} />
          <Route path="/analysis" lazy={lazyPage.analysis} />
          <Route path="/history" lazy={lazyPage.history} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </>,
  ),
);

function App() {
  const { initialize, user } = useAuthStore();
  const initializeTheme = useThemeStore((state) => state.initializeTheme);

  useNativeHealthSync(user?.id);
  useWhoopForegroundSync(user?.id);
  useNativeAuthCallback();

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Learn early whether native glass surfaces exist, so the first rest bar
  // or toast never flashes its web fallback.
  useEffect(() => {
    if (isNativeIOS()) void probeGlassSurfaces(NativeGlassSurfaces);
  }, []);

  useEffect(() => {
    return initializeTheme();
  }, [initializeTheme]);

  useEffect(() => warmLazyPages(), []);
  useEffect(() => watchRestTimerWorkoutEnd(useAppStore), []);
  useEffect(() => watchRestTimerSignOut(useAuthStore), []);

  // MotionConfig reducedMotion="user" wraps <App /> once in main.tsx.
  return <RouterProvider router={router} />;
}

export default App;
