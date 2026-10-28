import { Redirect } from 'expo-router';

import { useAuthScreen } from '~/lib/auth';

/** The way in: the app when signed in, otherwise sign-in or the offline wait. */
export default function Index() {
  const screen = useAuthScreen();
  // The splash screen stays up until the saved session has been read.
  if (screen === 'boot') return null;
  return <Redirect href={screen === 'app' ? '/today' : screen === 'offline' ? '/offline' : '/sign-in'} />;
}
