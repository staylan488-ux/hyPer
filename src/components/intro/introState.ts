export type IntroVariant = 'dashboard' | 'login';

const played = new Set<IntroVariant>();
const storageKey = (variant: IntroVariant) => `hyper:intro:${variant}:v2`;

/** Reading eligibility is safe in React's repeated initial renders. */
export function shouldPlayIntro(variant: IntroVariant): boolean {
  if (played.has(variant) || typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(storageKey(variant)) !== '1';
  } catch {
    return true;
  }
}

export function markIntroPlayed(variant: IntroVariant): void {
  played.add(variant);
  try {
    window.sessionStorage.setItem(storageKey(variant), '1');
  } catch {
    // The in-memory guard still prevents repeats when storage is unavailable.
  }
}
