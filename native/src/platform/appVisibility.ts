// Replaces ../src/lib/appVisibility.ts (see metro.config.js) with iOS app state.
//
// A web page is hidden only when another app or tab covers it. iOS also reports
// "inactive" for the app switcher, Control Center and system prompts, while the
// app is still on screen, so only "background" counts as hidden here. That keeps
// the same moments as the web: back from another app, or leaving for one.
import { AppState } from 'react-native';

export function isAppVisible(): boolean {
  return AppState.currentState !== 'background';
}

export function onAppVisible(listener: () => void): () => void {
  let away = AppState.currentState === 'background';
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background') away = true;
    else if (state === 'active' && away) {
      away = false;
      listener();
    }
  });
  return () => subscription.remove();
}

export function onAppHidden(listener: () => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background') listener();
  });
  return () => subscription.remove();
}
