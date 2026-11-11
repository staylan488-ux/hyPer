import * as Sentry from '@sentry/react-native';

import { isPreviewActive } from '~/platform/previewFlag';

/**
 * Crash reports from people's phones (Sentry), so a crash a stranger hits is
 * seen without anyone asking them. Off unless the build carries a DSN
 * (EXPO_PUBLIC_SENTRY_DSN, from .env through scripts/ship.sh), and never in
 * development or sample mode.
 *
 * Only what a crash needs: the error, its stack, the device and app version.
 * No names, emails or account ids, no screenshots, no performance tracing,
 * and web addresses lose everything after the path (queries can hold ids).
 * The privacy policy and Apple's privacy label list "crash data".
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ?? '';

/** Drops a URL's query and fragment: "https://x.supabase.co/rest/v1/sets?user_id=eq.…" → "…/sets". */
export function withoutQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

let started = false;
export function startCrashReporting(): void {
  if (started || !DSN || __DEV__ || isPreviewActive()) return;
  started = true;
  Sentry.init({
    dsn: DSN,
    // Release and build come from the app itself, as the source map upload names them.
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    reportAccessibilityIdentifier: false,
    // Console lines can quote food names or notes; keep only the app's own steps.
    beforeBreadcrumb: (breadcrumb) => {
      if (breadcrumb.category === 'console') return null;
      if (breadcrumb.data && 'url' in breadcrumb.data) {
        return { ...breadcrumb, data: { ...breadcrumb.data, url: withoutQuery(breadcrumb.data.url) } };
      }
      return breadcrumb;
    },
    beforeSend: (event) => {
      if (event.request?.url) event.request.url = withoutQuery(event.request.url) as string;
      delete event.user;
      return event;
    },
  });
}
