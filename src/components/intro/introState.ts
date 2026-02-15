const LOGIN_INTRO_KEY = 'hyper:intro:login:v1';
const DASHBOARD_INTRO_KEY = 'hyper:intro:dashboard:v1';

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function shouldPlayLoginIntro() {
  if (!canUseSessionStorage()) return false;

  return window.sessionStorage.getItem(LOGIN_INTRO_KEY) !== '1';
}

export function markLoginIntroPlayed() {
  if (!canUseSessionStorage()) return;

  window.sessionStorage.setItem(LOGIN_INTRO_KEY, '1');
}

export function shouldPlayDashboardIntro() {
  if (!canUseSessionStorage()) return false;

  return window.sessionStorage.getItem(DASHBOARD_INTRO_KEY) !== '1';
}

export function markDashboardIntroPlayed() {
  if (!canUseSessionStorage()) return;

  window.sessionStorage.setItem(DASHBOARD_INTRO_KEY, '1');
}
