import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuthScreen } from '~/lib/auth';
import { dropLaunchLink, pendingLaunchLink } from '~/lib/launchLink';

/** The way in: the app when signed in (after a new password, from a reset link), otherwise sign-in or the offline wait. */
export default function Index() {
  const screen = useAuthScreen();
  // A widget or card that launched the app opens its screen instead of Today,
  // once; a sign-in first drops it (lib/launchLink.ts).
  const [launch] = useState(pendingLaunchLink);
  const openModal = screen === 'app' && (launch === '/run' || launch === '/log-food');
  useEffect(() => {
    if (screen === 'app' || screen === 'sign-in') dropLaunchLink();
    // Modals (run, log-food) open over Today, so closing them lands there.
    if (openModal && launch) {
      router.replace('/today');
      router.push(launch);
    }
  }, [screen, openModal, launch]);
  // The splash screen stays up until the saved session has been read.
  if (screen === 'boot' || openModal) return null;
  const href =
    screen === 'app'
      ? (launch ?? '/today')
      : screen === 'update'
        ? '/update'
        : screen === 'new-password'
          ? '/new-password'
          : screen === 'not-approved'
            ? '/not-approved'
            : screen === 'offline'
              ? '/offline'
              : '/sign-in';
  return <Redirect href={href} />;
}
