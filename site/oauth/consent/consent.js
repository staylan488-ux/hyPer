// "Sign in with hyPer": draws the consent page and talks to Supabase.
//
// An MCP client (Claude, ChatGPT, …) sends a person to Supabase to connect
// hyPer, and Supabase sends them here with ?authorization_id=…. This page
// signs them in if it has to, shows who is asking and what for, and sends
// them back with a yes or a no.
//
// The rules are in logic.js, which the tests cover. Three things here are easy
// to get wrong:
// - Every word from outside (an app's name, an email, an address) is set as
//   text, never as markup.
// - Signing out is always `scope: 'local'`. The default signs the person out
//   everywhere, their iPhone included.
// - The sign-in lives in sessionStorage: it lasts for this tab, and the
//   marketing pages on the same site never hold a hyPer session.

import {
  ERROR_WORDS,
  MIN_PASSWORD_LENGTH,
  buildOAuthReturnUrl,
  checkSignInForm,
  classifyAuthorizationError,
  classifyAuthorizationResponse,
  clearAuthorizationId,
  createMemoryStorage,
  describeScopes,
  formatClientName,
  formatClientOrigin,
  friendlyAuthError,
  hasConfiguredSupabase,
  isSecretKey,
  persistAuthorizationId,
  readAuthReturnError,
  resolveAuthorizationId,
  resolveConfig,
  resolvePreview,
  safeRedirectTarget,
} from './logic.js';

// One exact version, the one the MCP function imports. A floating one would
// let the page's sign-in code change under it.
const SUPABASE_MODULE = 'https://esm.sh/@supabase/supabase-js@2.115.0';
const REQUEST_TIMEOUT_MS = 20_000;
// "Switch account" was used: Google asks which account, and a request that
// then turns out to be taken says why.
const SWITCHED_KEY = 'hyper.oauth.switched';

const PAGE_WORDS = {
  waiting: 'One moment…',
  returning: 'Returning to your agent…',
  done: 'You can close this page.',
  expiredTitle: 'This request has expired',
  expiredBody: 'Go back to your agent and connect hyPer again with this address.',
  otherAccountTitle: 'Connect again to use this account',
  otherAccountBody: 'This request is tied to the account you signed out of. Go back to your agent and connect hyPer again with this address.',
  problemTitle: 'Couldn’t load this request',
  setupTitle: 'Not ready yet',
  setupBody: 'Connecting an agent to hyPer isn’t switched on here yet. Try again later.',
  framedTitle: 'Open this page on its own',
  framedBody: 'For your safety, hyPer only asks for access in its own tab or window.',
  noReturnTitle: 'Couldn’t send you back',
  noReturnBody: 'hyPer couldn’t open your agent’s return address. Close this page and connect again.',
  copied: 'Copied',
  copyFailed: 'Address selected. Copy it from here.',
};

/** What `?preview=` shows in place of a real request. */
const SAMPLE = {
  authorization_id: 'preview',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { name: 'Claude' },
  user: { email: 'you@example.com' },
  scope: 'openid email profile',
};

const el = (id) => document.getElementById(id);

const views = Array.from(document.querySelectorAll('[data-view]'));
const announcer = el('announcer');
const waitingText = el('waiting-text');
const waitingSpinner = el('waiting-spinner');
const googleButton = el('google');
const form = el('signin-form');
const emailField = el('email');
const passwordField = el('password');
const signinButton = el('signin');
const signinError = el('signin-error');
const consentTitle = el('consent-title');
const consentOrigin = el('consent-origin');
const consentLead = el('consent-lead');
const consentIdentity = el('consent-identity');
const consentScopes = el('consent-scopes');
const consentAccount = el('consent-account');
const consentError = el('consent-error');
const switchButton = el('switch-account');
const allowButton = el('allow');
const cancelButton = el('cancel');
const directTitle = el('direct-title');
const directBody = el('direct-body');
const mcpUrl = el('mcp-url');
const copyButton = el('copy');
const copyLabel = el('copy-label');
const problemTitle = el('problem-title');
const problemBody = el('problem-body');
const retryButton = el('retry');
const controls = Array.from(document.querySelectorAll('.capsule, .link'));

const DIRECT_WORDS = { title: directTitle.textContent, body: directBody.textContent };
const PAGE_TITLE = document.title;

const state = {
  /** The Supabase client, once the page needs one. */
  client: null,
  storage: createMemoryStorage(),
  authorizationId: null,
  clientName: null,
  /** A button is working; every other press waits. */
  busy: false,
  /** The answer is given and the browser is on its way out. */
  leaving: false,
  /** The state `?preview=` asked for; nothing is sent while it is set. */
  preview: null,
  retry: null,
  shown: 'waiting',
};

/* ── Drawing ──────────────────────────────────────────────────────────── */

function announce(message) {
  announcer.textContent = '';
  if (message) window.setTimeout(() => { announcer.textContent = message; }, 80);
}

/** Shows one view. A new view takes the focus on its heading, so a screen reader starts there. */
function show(name, title) {
  const changed = state.shown !== name;
  for (const view of views) view.hidden = view.dataset.view !== name;
  state.shown = name;
  document.title = title ? `${title} · hyPer` : PAGE_TITLE;
  if (!changed) return;
  window.scrollTo(0, 0);
  const heading = views.find((view) => view.dataset.view === name)?.querySelector('[tabindex="-1"]');
  heading?.focus({ preventScroll: true });
}

/** A wait that follows another view shows at once; the page's first check gets a short pause first. */
function showWaiting(text, { spinner = true } = {}) {
  const arriving = state.shown !== 'waiting';
  const changed = waitingText.textContent !== text;
  waitingText.textContent = text;
  waitingSpinner.hidden = !spinner;
  if (arriving) views.find((view) => view.dataset.view === 'waiting')?.setAttribute('data-now', '');
  show('waiting');
  if (arriving || changed) announce(text);
}

function setError(target, message) {
  target.textContent = message ?? '';
  target.hidden = !message;
  if (message) announce(message);
}

/** One button works at a time; the rest sit back until it is done. */
function setBusy(button) {
  state.busy = Boolean(button);
  for (const control of controls) {
    control.removeAttribute('aria-busy');
    if (state.busy && control !== button) control.setAttribute('aria-disabled', 'true');
    else control.removeAttribute('aria-disabled');
  }
  if (button) button.setAttribute('aria-busy', 'true');
  emailField.readOnly = state.busy;
  passwordField.readOnly = state.busy;
  if (!state.busy) syncSignInReady();
}

/** A browser can fill a saved password in before it lets the page read it. */
function autofilled(field) {
  for (const selector of [':autofill', ':-webkit-autofill']) {
    try {
      if (field.matches(selector)) return true;
    } catch {
      // This browser does not know the selector.
    }
  }
  return false;
}

/** Sign in sits back until the form could be sent. It still answers a press: it says what is missing. */
function syncSignInReady() {
  if (state.busy) return;
  const ready =
    (emailField.value.trim().length > 0 || autofilled(emailField)) &&
    (passwordField.value.length >= MIN_PASSWORD_LENGTH || autofilled(passwordField));
  if (ready) signinButton.removeAttribute('aria-disabled');
  else signinButton.setAttribute('aria-disabled', 'true');
}

function showSignIn(message) {
  setBusy(null);
  passwordField.value = '';
  emailField.removeAttribute('aria-invalid');
  passwordField.removeAttribute('aria-invalid');
  syncSignInReady();
  show('signin', 'Sign in');
  setError(signinError, message);
}

function showConsent(details) {
  setBusy(null);
  const name = formatClientName(details.client?.name);
  state.clientName = name;
  const title = name ? `Connect ${name}` : 'Connect an app';
  consentTitle.textContent = title;
  consentLead.textContent = name ? `${name} will be able to` : 'It will be able to';

  const origin = formatClientOrigin(details);
  consentOrigin.textContent = origin ?? '';
  consentOrigin.hidden = !origin;

  const scopes = describeScopes(details.scope);
  consentIdentity.textContent = scopes.identity ?? '';
  consentIdentity.hidden = !scopes.identity;
  consentScopes.textContent = scopes.others.length ? `Also asked for: ${scopes.others.join(' ')}` : '';
  consentScopes.hidden = scopes.others.length === 0;

  const email = typeof details.user?.email === 'string' ? details.user.email.trim() : '';
  consentAccount.textContent = email ? 'Signed in as ' : 'Signed in';
  if (email) {
    const who = document.createElement('span');
    who.className = 'account__name';
    who.textContent = email;
    consentAccount.append(who);
  }

  setError(consentError, null);
  show('consent', title);
}

/** The page with hyPer's address: opened without a request, or the request can no longer be answered. */
function showDirect(variant) {
  setBusy(null);
  const words =
    variant === 'expired' ? { title: PAGE_WORDS.expiredTitle, body: PAGE_WORDS.expiredBody }
    : variant === 'other-account' ? { title: PAGE_WORDS.otherAccountTitle, body: PAGE_WORDS.otherAccountBody }
    : DIRECT_WORDS;
  directTitle.textContent = words.title;
  directBody.textContent = words.body;
  show('direct', variant === 'direct' ? 'Connect an agent' : words.title);
}

function showProblem(title, body, retry) {
  setBusy(null);
  state.retry = retry ?? null;
  problemTitle.textContent = title;
  problemBody.textContent = body;
  retryButton.hidden = !retry;
  show('problem', title);
}

/* ── Leaving ──────────────────────────────────────────────────────────── */

/** Back to the agent, with the answer in the address Supabase built. */
function leave(redirectUrl) {
  const target = safeRedirectTarget(redirectUrl);
  if (!target) {
    showProblem(PAGE_WORDS.noReturnTitle, PAGE_WORDS.noReturnBody, null);
    return;
  }
  state.leaving = true;
  clearAuthorizationId(state.storage);
  forget(SWITCHED_KEY);
  showWaiting(state.clientName ? `Returning to ${state.clientName}…` : PAGE_WORDS.returning);
  window.location.replace(target);
  // An app's own address (cursor://…) opens the app and leaves this page
  // behind; a web address replaces it.
  if (!/^https?:/i.test(target)) {
    window.setTimeout(() => showWaiting(PAGE_WORDS.done, { spinner: false }), 2500);
  }
}

function remember(key) {
  try {
    state.storage.setItem(key, '1');
  } catch {
    // Not kept; the page still works.
  }
}

function recall(key) {
  try {
    return state.storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function forget(key) {
  try {
    state.storage.removeItem(key);
  } catch {
    // Nothing was kept.
  }
}

/** The request is used up, timed out, or belongs to the account that was signed out. */
function showEnded() {
  const switched = recall(SWITCHED_KEY);
  clearAuthorizationId(state.storage);
  forget(SWITCHED_KEY);
  showDirect(switched ? 'other-account' : 'expired');
}

/* ── Supabase ─────────────────────────────────────────────────────────── */

function withTimeout(work, ms = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timed out')), ms);
    Promise.resolve(work).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** This tab only: the default would sign the person out on their iPhone too. */
async function signOutHere() {
  try {
    await withTimeout(state.client.auth.signOut({ scope: 'local' }), 8000);
  } catch {
    // The saved sign-in is cleared before the server is told; that is enough here.
  }
}

async function loadAuthorization() {
  showWaiting(PAGE_WORDS.waiting);
  let answer;
  try {
    answer = await withTimeout(state.client.auth.oauth.getAuthorizationDetails(state.authorizationId));
  } catch (error) {
    showProblem(PAGE_WORDS.problemTitle, friendlyAuthError(error) ?? ERROR_WORDS.unknown, loadAuthorization);
    return;
  }
  if (answer.error) {
    await authorizationFailed(answer.error, (words) => showProblem(PAGE_WORDS.problemTitle, words, loadAuthorization));
    return;
  }
  const outcome = classifyAuthorizationResponse(answer.data);
  if (outcome.kind === 'redirect') {
    // Allowed before: straight back, with nothing to ask.
    leave(outcome.redirectUrl);
  } else if (outcome.kind === 'consent') {
    forget(SWITCHED_KEY);
    showConsent(outcome.details);
  } else {
    showProblem(PAGE_WORDS.problemTitle, ERROR_WORDS.server, loadAuthorization);
  }
}

/** A request that could not be read or answered: sign in again, start again, or say what went wrong. */
async function authorizationFailed(error, say) {
  const next = classifyAuthorizationError(error);
  if (next === 'signin') {
    await signOutHere();
    showSignIn(ERROR_WORDS.signedOut);
  } else if (next === 'expired') {
    showEnded();
  } else {
    say(friendlyAuthError(error) ?? ERROR_WORDS.unknown);
  }
}

/* ── Actions ──────────────────────────────────────────────────────────── */

/** In a preview a press shows the button working, then the next state, and sends nothing. */
function pretend(then) {
  window.setTimeout(() => {
    setBusy(null);
    then?.();
  }, 1300);
}

async function continueWithGoogle() {
  if (state.busy || state.leaving) return;
  setError(signinError, null);
  setBusy(googleButton);
  if (state.preview) {
    pretend(() => showConsent(SAMPLE));
    return;
  }
  try {
    const { error } = await withTimeout(
      state.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Back to this page, with its request still in the address.
          redirectTo: buildOAuthReturnUrl(window.location, state.authorizationId),
          ...(recall(SWITCHED_KEY) ? { queryParams: { prompt: 'select_account' } } : {}),
        },
      }),
    );
    if (error) {
      setBusy(null);
      setError(signinError, friendlyAuthError(error) ?? ERROR_WORDS.unknown);
    }
    // Otherwise the browser is leaving for Google, and the button keeps working.
  } catch (error) {
    setBusy(null);
    setError(signinError, friendlyAuthError(error) ?? ERROR_WORDS.unknown);
  }
}

async function submitPassword() {
  if (state.busy || state.leaving) return;
  const missing = checkSignInForm(emailField.value, passwordField.value);
  if (missing) {
    const field = missing.field === 'email' ? emailField : passwordField;
    // Return on the email, with no password yet, moves on as the keyboard's "next" does.
    const movingOn = missing.field === 'password' && !passwordField.value && document.activeElement === emailField;
    field.focus();
    if (movingOn) return;
    field.setAttribute('aria-invalid', 'true');
    setError(signinError, missing.message);
    return;
  }
  setError(signinError, null);
  setBusy(signinButton);
  if (state.preview) {
    pretend(() => showConsent(SAMPLE));
    return;
  }
  let failure = null;
  try {
    const { error } = await withTimeout(
      state.client.auth.signInWithPassword({ email: emailField.value.trim(), password: passwordField.value }),
    );
    failure = error;
  } catch (error) {
    failure = error;
  }
  setBusy(null);
  if (failure) {
    setError(signinError, friendlyAuthError(failure) ?? ERROR_WORDS.unknown);
    return;
  }
  passwordField.value = '';
  await loadAuthorization();
}

async function decide(action) {
  if (state.busy || state.leaving) return;
  setError(consentError, null);
  setBusy(action === 'approve' ? allowButton : cancelButton);
  if (state.preview) {
    pretend(() => {
      state.leaving = true;
      showWaiting(`Returning to ${SAMPLE.client.name}…`);
    });
    return;
  }
  let answer;
  try {
    const oauth = state.client.auth.oauth;
    // The page opens the return address itself, once it has checked it.
    answer = await withTimeout(
      action === 'approve'
        ? oauth.approveAuthorization(state.authorizationId, { skipBrowserRedirect: true })
        : oauth.denyAuthorization(state.authorizationId, { skipBrowserRedirect: true }),
    );
  } catch (error) {
    setBusy(null);
    setError(consentError, friendlyAuthError(error) ?? ERROR_WORDS.unknown);
    return;
  }
  // The buttons stay as they are until the answer is dealt with, so no second press slips in.
  const sayHere = (words) => {
    setBusy(null);
    setError(consentError, words);
  };
  if (answer.error) {
    await authorizationFailed(answer.error, sayHere);
    return;
  }
  const outcome = classifyAuthorizationResponse(answer.data);
  if (outcome.kind === 'redirect') leave(outcome.redirectUrl);
  else sayHere(ERROR_WORDS.server);
}

/** Signs out of this page and keeps the request, to sign in as someone else. */
async function switchAccount() {
  if (state.busy || state.leaving) return;
  setBusy(switchButton);
  if (state.preview) {
    pretend(() => showSignIn(null));
    return;
  }
  await signOutHere();
  remember(SWITCHED_KEY);
  emailField.value = '';
  showSignIn(null);
}

let copyTimer = 0;

async function copyAddress() {
  const address = mcpUrl.textContent ?? '';
  let copied = false;
  try {
    await navigator.clipboard.writeText(address);
    copied = true;
  } catch {
    // No clipboard here (an older browser, or not a secure page): select the
    // address so it can be copied by hand.
    const range = document.createRange();
    range.selectNodeContents(mcpUrl);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  if (!copied) {
    announce(PAGE_WORDS.copyFailed);
    return;
  }
  copyLabel.textContent = PAGE_WORDS.copied;
  announce(PAGE_WORDS.copied);
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => { copyLabel.textContent = 'Copy'; }, 2000);
}

/* ── Start ────────────────────────────────────────────────────────────── */

/** sessionStorage, or memory where a browser refuses it. */
function tabStorage() {
  try {
    const storage = window.sessionStorage;
    storage.setItem('hyper.oauth.probe', '1');
    storage.removeItem('hyper.oauth.probe');
    return storage;
  } catch {
    return createMemoryStorage();
  }
}

function readConfig() {
  const meta = (name) => document.querySelector(`meta[name="hyper:${name}"]`)?.getAttribute('content') ?? '';
  return resolveConfig(window.HYPER_OAUTH_CONFIG, {
    supabaseUrl: meta('supabase-url'),
    supabaseAnonKey: meta('supabase-anon-key'),
    mcpUrl: meta('mcp-url'),
  });
}

/** Leaves only the request in the address, so a reload starts clean. */
function tidyAddress() {
  const clean = buildOAuthReturnUrl(window.location, state.authorizationId);
  if (clean && clean !== window.location.href) window.history.replaceState(window.history.state, '', clean);
}

function renderPreview(name) {
  state.preview = name;
  el('preview-tag').hidden = false;
  state.clientName = SAMPLE.client.name;
  if (name === 'loading') showWaiting(PAGE_WORDS.waiting);
  else if (name === 'signin') showSignIn(null);
  else if (name === 'error') {
    showSignIn(null);
    emailField.value = SAMPLE.user.email;
    passwordField.value = 'not-the-password';
    syncSignInReady();
    setError(signinError, ERROR_WORDS.wrongPassword);
  } else if (name === 'consent') showConsent(SAMPLE);
  else if (name === 'direct') showDirect('direct');
  else if (name === 'expired') showDirect('expired');
  else if (name === 'problem') showProblem(PAGE_WORDS.problemTitle, ERROR_WORDS.offline, () => pretend());
  else if (name === 'returning') showWaiting(`Returning to ${SAMPLE.client.name}…`);
}

async function start() {
  const config = readConfig();
  mcpUrl.textContent = config.mcpUrl;

  // A consent page inside someone else's frame can be dressed up to steal a
  // press. The server's headers forbid framing; this holds if they are lost.
  if (window.top !== window.self) {
    showProblem(PAGE_WORDS.framedTitle, PAGE_WORDS.framedBody, null);
    return;
  }

  const preview = resolvePreview(window.location.search);
  if (preview) {
    renderPreview(preview);
    return;
  }

  state.storage = tabStorage();
  state.authorizationId = resolveAuthorizationId(window.location.search, state.storage);
  if (!state.authorizationId) {
    showDirect('direct');
    return;
  }
  persistAuthorizationId(state.authorizationId, state.storage);

  if (isSecretKey(config.supabaseAnonKey)) {
    console.error('hyPer consent page: config.js holds a secret or service-role key. Replace it with the public anon key, and rotate the secret.');
    showProblem(PAGE_WORDS.setupTitle, PAGE_WORDS.setupBody, null);
    return;
  }
  if (!hasConfiguredSupabase(config)) {
    console.warn('hyPer consent page: set supabaseUrl and supabaseAnonKey in /oauth/consent/config.js.');
    showProblem(PAGE_WORDS.setupTitle, PAGE_WORDS.setupBody, null);
    return;
  }

  // What a sign-in that just came back left in the address, read before Supabase's client tidies it.
  const returned = readAuthReturnError(window.location.search, window.location.hash);
  const cameBack = new URLSearchParams(window.location.search).has('code');

  await connect(config, returned, cameBack);
}

async function connect(config, returned, cameBack) {
  showWaiting(PAGE_WORDS.waiting);
  let session = null;
  try {
    if (!state.client) {
      const { createClient } = await withTimeout(import(SUPABASE_MODULE));
      state.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          storage: state.storage,
        },
      });
    }
    // Waits for the client to finish a sign-in that came back in the address.
    const { data } = await withTimeout(state.client.auth.getSession());
    session = data?.session ?? null;
  } catch (error) {
    showProblem(PAGE_WORDS.problemTitle, friendlyAuthError(error) ?? ERROR_WORDS.unknown, () => void connect(config, returned, cameBack));
    return;
  }
  tidyAddress();

  if (!session) {
    const words = returned ? friendlyAuthError(returned) : cameBack ? ERROR_WORDS.unfinished : null;
    showSignIn(words);
    return;
  }
  await loadAuthorization();
}

googleButton.addEventListener('click', () => void continueWithGoogle());
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitPassword();
});
for (const field of [emailField, passwordField]) {
  for (const type of ['input', 'change']) {
    field.addEventListener(type, () => {
      field.removeAttribute('aria-invalid');
      if (!signinError.hidden && !state.busy) setError(signinError, null);
      syncSignInReady();
    });
  }
}
allowButton.addEventListener('click', () => void decide('approve'));
cancelButton.addEventListener('click', () => void decide('deny'));
switchButton.addEventListener('click', () => void switchAccount());
copyButton.addEventListener('click', () => void copyAddress());
retryButton.addEventListener('click', () => {
  if (state.busy || !state.retry) return;
  setBusy(retryButton);
  void state.retry();
});
// Back from Google or from the agent out of the browser's page cache: start again from what is true now.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

start().catch((error) => {
  console.error('hyPer consent page:', error);
  showProblem(PAGE_WORDS.problemTitle, ERROR_WORDS.unknown, () => window.location.reload());
});
