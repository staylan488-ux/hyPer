// "Sign in with hyPer": the rules of the consent page.
//
// Nothing here touches the browser when the file is loaded, so the tests import
// it directly (tests/oauthConsentPage.test.ts). consent.js draws the page with
// these rules.
//
// Three rules hold everything else up:
// - The request's id goes into a web address, so only plain id characters pass.
// - Words from the page's address or from a sign-in error are never shown.
//   A person only ever reads one of the sentences written in this file.
// - The page sends a person on only to an address that cannot run as script.

/**
 * What the page keeps between visits, such as `sessionStorage`.
 * @typedef {object} StorageLike
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

/**
 * The public settings the page runs on.
 * @typedef {object} ConsentConfig
 * @property {string} [supabaseUrl]
 * @property {string} [supabaseAnonKey]
 * @property {string} [mcpUrl]
 */

/**
 * The app asking for access, as Supabase describes it.
 * @typedef {object} OAuthClientLike
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [uri]
 * @property {string} [logo_uri]
 */

/**
 * A request waiting for a yes or no (Supabase's OAuthAuthorizationDetails).
 * @typedef {object} AuthorizationDetailsLike
 * @property {string} authorization_id
 * @property {string} [redirect_uri]
 * @property {OAuthClientLike} [client]
 * @property {{ id?: string, email?: string }} [user]
 * @property {string} [scope]
 */

/**
 * @typedef {{ kind: 'consent', details: AuthorizationDetailsLike }
 *   | { kind: 'redirect', redirectUrl: string }
 *   | { kind: 'invalid' }} AuthorizationOutcome
 */

/**
 * A state `?preview=` can show. `error` is sign-in with a failure under the
 * form; `problem` is the page that says a request could not be loaded.
 * @typedef {'loading' | 'signin' | 'error' | 'consent' | 'direct' | 'expired' | 'problem' | 'returning'} PreviewState
 */

export const AUTHORIZATION_PARAM = 'authorization_id';
export const AUTHORIZATION_STORAGE_KEY = 'hyper.oauth.authorization_id';
export const DEFAULT_MCP_URL = 'https://mcp.thehyper.app';

/** The states `?preview=` can show. */
export const PREVIEW_STATES = /** @type {readonly PreviewState[]} */ (
  Object.freeze(['loading', 'signin', 'error', 'consent', 'direct', 'expired', 'problem', 'returning'])
);

/** Every sentence a failure can show. Nothing else is ever shown for one. */
export const ERROR_WORDS = Object.freeze({
  wrongPassword: 'That email and password don’t match. Check them and try again.',
  noAccount: 'That email has no hyPer account. Sign in the way you do in the app.',
  unconfirmed: 'Confirm your email first. Open the link hyPer sent you, then sign in here.',
  blocked: 'This account can’t sign in. If that seems wrong, contact support.',
  tooMany: 'Too many tries for now. Wait a minute, then try again.',
  offline: 'Couldn’t reach hyPer. Check your connection and try again.',
  requestEnded: 'This request has expired. Go back to your agent and connect again.',
  signedOut: 'Your sign-in ran out. Sign in again to continue.',
  unfinished: 'That sign-in didn’t finish. Try again.',
  noGoogle: 'Google sign-in isn’t available here yet. Use your email and password.',
  server: 'hyPer didn’t answer. Try again in a moment.',
  unknown: 'That didn’t work. Try again.',
});

/** The shortest password sign-in sends: the project's minimum, which older accounts may still use (as in the app). */
export const MIN_PASSWORD_LENGTH = 6;

/** What the form says when it is sent before it is filled in. */
export const FORM_WORDS = Object.freeze({
  needEmail: 'Enter your email.',
  needPassword: 'Enter your password.',
  shortPassword: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
});

/**
 * What is still missing from the sign-in form, and which field to go to.
 * Null when it can be sent.
 * @param {unknown} email
 * @param {unknown} password
 * @returns {{ field: 'email' | 'password', message: string } | null}
 */
export function checkSignInForm(email, password) {
  const address = typeof email === 'string' ? email.trim() : '';
  const secret = typeof password === 'string' ? password : '';
  if (!address) return { field: 'email', message: FORM_WORDS.needEmail };
  if (!secret) return { field: 'password', message: FORM_WORDS.needPassword };
  if (secret.length < MIN_PASSWORD_LENGTH) return { field: 'password', message: FORM_WORDS.shortPassword };
  return null;
}

/* ── The request's id ─────────────────────────────────────────────────── */

// The id becomes part of a request path. Letters, digits and "-._~" cannot
// leave that path; a segment of dots alone could, so it is refused too.
const AUTHORIZATION_ID = /^[A-Za-z0-9._~-]{1,256}$/;

/**
 * Whether a value can be a request's id.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidAuthorizationId(value) {
  return typeof value === 'string' && AUTHORIZATION_ID.test(value) && !/^\.+$/.test(value);
}

/**
 * @param {unknown} search
 * @returns {URLSearchParams}
 */
function paramsOf(search) {
  try {
    return new URLSearchParams(String(search ?? '').replace(/^[?#]/, ''));
  } catch {
    return new URLSearchParams();
  }
}

/**
 * The id kept from before a sign-in left the page.
 * @param {StorageLike | null | undefined} storage
 * @returns {string | null}
 */
function storedAuthorizationId(storage) {
  try {
    const stored = storage?.getItem(AUTHORIZATION_STORAGE_KEY);
    return isValidAuthorizationId(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * The request this page is for: the one in the address, or else the one kept
 * from before a sign-in left the page. An address that names a request, but
 * not a usable one, gets nothing rather than an older request.
 * @param {string | null | undefined} search The address's query, such as `location.search`.
 * @param {StorageLike | null} [storage]
 * @returns {string | null}
 */
export function resolveAuthorizationId(search, storage) {
  const named = paramsOf(search).getAll(AUTHORIZATION_PARAM);
  if (named.length > 0) return named.length === 1 && isValidAuthorizationId(named[0]) ? named[0] : null;
  return storedAuthorizationId(storage);
}

/**
 * Keeps the request across a sign-in that leaves the page.
 * @param {string | null | undefined} id
 * @param {StorageLike | null} [storage]
 * @returns {boolean} Whether it was kept.
 */
export function persistAuthorizationId(id, storage) {
  if (!isValidAuthorizationId(id) || !storage) return false;
  try {
    storage.setItem(AUTHORIZATION_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Forgets the kept request: it was answered, or it can no longer be.
 * @param {StorageLike | null} [storage]
 */
export function clearAuthorizationId(storage) {
  try {
    storage?.removeItem(AUTHORIZATION_STORAGE_KEY);
  } catch {
    // Nothing was kept.
  }
}

/**
 * Storage that lasts as long as the page, for a browser that refuses
 * `sessionStorage`.
 * @returns {StorageLike}
 */
export function createMemoryStorage() {
  /** @type {Map<string, string>} */
  const kept = new Map();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, String(value));
    },
    removeItem: (key) => {
      kept.delete(key);
    },
  };
}

/**
 * The address a sign-in comes back to: this page with its request and nothing
 * else. What an earlier attempt left in the address (a code, an error, a state)
 * is dropped, and so is the fragment.
 * @param {{ href?: string, origin?: string, pathname?: string } | null | undefined} locationLike
 * @param {string | null | undefined} authorizationId
 * @returns {string} An empty string when the address is not a web address.
 */
export function buildOAuthReturnUrl(locationLike, authorizationId) {
  let url;
  try {
    url = new URL(locationLike?.href ?? `${locationLike?.origin ?? ''}${locationLike?.pathname ?? '/'}`);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  if (isValidAuthorizationId(authorizationId)) url.searchParams.set(AUTHORIZATION_PARAM, authorizationId);
  return url.toString();
}

/* ── Where the page may send someone ──────────────────────────────────── */

// Addresses that run as script here, open a local file or page, or hand the
// answer to something that is not an app's own return address.
const BLOCKED_SCHEMES = new Set([
  'javascript', 'data', 'vbscript', 'file', 'about', 'blob', 'filesystem', 'view-source',
  'intent', 'ws', 'wss', 'ftp', 'mailto', 'tel', 'sms',
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * @param {unknown} value
 * @returns {URL | null}
 */
function parseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * A web address that is safe to show or link to: http or https with a host.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isSafeExternalUrl(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname);
}

/**
 * The address to send someone back to their agent at, in the browser's own
 * spelling, or null when it must not be opened. The same addresses Supabase
 * accepts when an app registers: https, http on this device only, or an app's
 * own scheme (such as cursor://).
 * @param {unknown} url
 * @returns {string | null}
 */
export function safeRedirectTarget(url) {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) return null;
  if (scheme === 'https') return parsed.hostname ? parsed.href : null;
  if (scheme === 'http') return LOOPBACK_HOSTS.has(parsed.hostname) ? parsed.href : null;
  return parsed.href;
}

/**
 * Whether the page may send someone to this address (see safeRedirectTarget).
 * @param {unknown} url
 * @returns {boolean}
 */
export function isSafeRedirectUrl(url) {
  return safeRedirectTarget(url) !== null;
}

/* ── Who is asking ────────────────────────────────────────────────────── */

/**
 * @param {unknown} url
 * @returns {string | null}
 */
function hostOf(url) {
  if (!isSafeExternalUrl(url)) return null;
  const { hostname } = new URL(/** @type {string} */ (url));
  if (LOOPBACK_HOSTS.has(hostname)) return 'this device';
  return hostname.replace(/^www\./, '');
}

/**
 * The host an approval goes back to, such as "claude.ai", or "this device" for
 * an app on this computer.
 *
 * It comes from the request's return address, which Supabase checks against
 * the ones the app registered. An app writes its own name and website, so a
 * website is only read for a client given alone, and never when the request
 * names a return address that is not a web address.
 * @param {(AuthorizationDetailsLike | OAuthClientLike | { redirect_uri?: string, uri?: string, client?: OAuthClientLike }) | null | undefined} source
 * @returns {string | null}
 */
export function formatClientOrigin(source) {
  if (!source || typeof source !== 'object') return null;
  const request = /** @type {{ redirect_uri?: unknown, uri?: unknown, client?: { uri?: unknown } }} */ (source);
  if (typeof request.redirect_uri === 'string' && request.redirect_uri.trim()) return hostOf(request.redirect_uri);
  return hostOf(request.client?.uri ?? request.uri);
}

const NAME_LIMIT = 40;

/**
 * An app's name as the page shows it: one line, no hidden or direction-changing
 * characters, at most 40 characters. Null when nothing readable is left.
 * @param {unknown} name
 * @returns {string | null}
 */
export function formatClientName(name) {
  if (typeof name !== 'string') return null;
  const plain = name
    // Invisible and direction-changing characters go; line breaks become spaces.
    .replace(/[\p{Cf}\p{Co}\p{Cs}\p{Cn}]/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ')
    .trim();
  if (!plain) return null;
  const letters = Array.from(plain);
  return letters.length > NAME_LIMIT ? `${letters.slice(0, NAME_LIMIT - 1).join('').trimEnd()}…` : plain;
}

const IDENTITY_SCOPES = /** @type {const} */ ([
  ['profile', 'name'],
  ['email', 'email address'],
  ['phone', 'phone number'],
]);

/**
 * What the requested scopes add to what hyPer's server offers. Scopes cover
 * who you are, not your data: "email" shares your email address with the app.
 * `others` are scopes this page has no words for, kept so that nothing asked
 * for is hidden.
 * @param {unknown} scope A space-separated list, such as "openid email profile".
 * @returns {{ identity: string | null, others: string[] }}
 */
export function describeScopes(scope) {
  const asked = [...new Set((typeof scope === 'string' ? scope : '').split(/\s+/).filter(Boolean))];
  const shared = IDENTITY_SCOPES.filter(([name]) => asked.includes(name)).map(([, words]) => words);
  const known = new Set(['openid', ...IDENTITY_SCOPES.map(([name]) => name)]);
  // The characters OAuth allows in a scope's name: printable, no space, quote or backslash.
  const others = asked.filter((name) => !known.has(name) && /^[\x21\x23-\x5B\x5D-\x7E]{1,40}$/.test(name)).slice(0, 5);
  if (shared.length === 0) return { identity: null, others };
  const list = shared.length === 1 ? shared[0] : `${shared.slice(0, -1).join(', ')} and ${shared[shared.length - 1]}`;
  return { identity: `See your ${list}`, others };
}

/* ── What Supabase answered ───────────────────────────────────────────── */

/**
 * Whether a request still needs a yes or no (its details came back), or was
 * allowed before or just answered (an address to return to came back).
 * @param {unknown} data
 * @returns {AuthorizationOutcome}
 */
export function classifyAuthorizationResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { kind: 'invalid' };
  const answer = /** @type {{ authorization_id?: unknown, redirect_url?: unknown }} */ (data);
  if ('authorization_id' in answer) {
    return typeof answer.authorization_id === 'string' && answer.authorization_id
      ? { kind: 'consent', details: /** @type {AuthorizationDetailsLike} */ (data) }
      : { kind: 'invalid' };
  }
  if (typeof answer.redirect_url === 'string' && answer.redirect_url.trim()) {
    return { kind: 'redirect', redirectUrl: answer.redirect_url };
  }
  return { kind: 'invalid' };
}

/**
 * What a sign-in left in the address when it came back with a failure.
 * Supabase writes it in the query, the fragment, or both.
 * @param {string | null | undefined} search
 * @param {string | null | undefined} [hash]
 * @returns {{ error: string, code: string, description: string } | null}
 */
export function readAuthReturnError(search, hash) {
  const query = paramsOf(search);
  const fragment = paramsOf(hash);
  const read = (/** @type {string} */ name) => (query.get(name) ?? fragment.get(name) ?? '').slice(0, 300);
  const found = { error: read('error'), code: read('error_code'), description: read('error_description') };
  return found.error || found.code || found.description ? found : null;
}

/**
 * @param {unknown} error
 * @returns {{ text: string, code: string, oauth: string, status: number, name: string } | null}
 */
function factsOf(error) {
  if (error === null || error === undefined || error === '') return null;
  if (typeof error === 'string') return { text: error.toLowerCase(), code: '', oauth: '', status: 0, name: '' };
  if (typeof error !== 'object') return { text: '', code: '', oauth: '', status: 0, name: '' };
  const given = /** @type {Record<string, unknown>} */ (error);
  const word = (/** @type {unknown} */ value) => (typeof value === 'string' ? value : '');
  const oauth = word(given.error).toLowerCase();
  const message = [given.message, given.description, given.error_description, given.msg].map(word).join(' ');
  return {
    text: `${message} ${oauth}`.toLowerCase(),
    code: word(given.code || given.error_code).toLowerCase(),
    oauth,
    status: typeof given.status === 'number' && Number.isFinite(given.status) ? given.status : 0,
    name: word(given.name),
  };
}

// Sign-ups the invite list refused, in the ways Supabase reports them (the
// same list as src/lib/betaAccess.ts). Here it means the email has no account.
const SIGNUP_REFUSED = /database error saving new user|invite-only|not invited|signups? (are |is )?not allowed|signups? (is )?disabled|signup_disabled/;
const REQUEST_ENDED = /authorization not found|cannot be processed|no longer pending/;
const SESSION_GONE = /auth session missing|session (is )?(missing|expired|not found)|jwt expired|invalid jwt|bad jwt/;
const SESSION_CODES = new Set(['session_not_found', 'session_expired', 'bad_jwt', 'no_authorization', 'refresh_token_not_found', 'refresh_token_already_used']);
const OFFLINE = /failed to fetch|fetch failed|load failed|network request failed|networkerror|network error|timed? ?out|dynamically imported module|importing a module script failed/;
const UNFINISHED_CODES = new Set(['bad_code_verifier', 'flow_state_not_found', 'flow_state_expired', 'bad_oauth_state', 'bad_oauth_callback']);
const NO_PROVIDER_CODES = new Set(['provider_disabled', 'oauth_provider_not_supported', 'email_provider_disabled']);

/**
 * @param {NonNullable<ReturnType<typeof factsOf>>} facts
 * @returns {boolean}
 */
function requestEnded(facts) {
  return facts.code === 'oauth_authorization_not_found' || REQUEST_ENDED.test(facts.text);
}

/**
 * @param {NonNullable<ReturnType<typeof factsOf>>} facts
 * @returns {boolean}
 */
function sessionGone(facts) {
  return facts.name === 'AuthSessionMissingError' || SESSION_CODES.has(facts.code) || SESSION_GONE.test(facts.text) || facts.status === 401;
}

/**
 * A failure said plainly, in hyPer's words: what happened and what to do next.
 * Null when there is nothing to say, as when someone backs out of Google's
 * sheet (a choice, not a failure). Only ever one of ERROR_WORDS: an error's
 * own text can come from the page's address, so it is never shown.
 * @param {unknown} error An error from Supabase, what readAuthReturnError found, or a message.
 * @returns {string | null}
 */
export function friendlyAuthError(error) {
  const facts = factsOf(error);
  if (!facts) return null;
  const { text, code, oauth, status, name } = facts;

  if (code === 'signup_disabled' || SIGNUP_REFUSED.test(text)) return ERROR_WORDS.noAccount;
  if (code === 'invalid_credentials' || /invalid login credentials/.test(text)) return ERROR_WORDS.wrongPassword;
  if (code === 'email_not_confirmed' || code === 'provider_email_needs_verification' || /email not confirmed/.test(text)) return ERROR_WORDS.unconfirmed;
  if (code === 'user_banned' || /user is banned/.test(text)) return ERROR_WORDS.blocked;
  if (status === 429 || /^over_.*_rate_limit$/.test(code) || /rate limit|only request this after|too many requests/.test(text)) return ERROR_WORDS.tooMany;
  if (name === 'AuthRetryableFetchError' || OFFLINE.test(text)) return ERROR_WORDS.offline;
  if (requestEnded(facts)) return ERROR_WORDS.requestEnded;
  if (sessionGone(facts)) return ERROR_WORDS.signedOut;
  if (UNFINISHED_CODES.has(code) || /code verifier|flow state|oauth state|code exchange/.test(text)) return ERROR_WORDS.unfinished;
  if (NO_PROVIDER_CODES.has(code) || /unsupported provider|provider is not enabled/.test(text)) return ERROR_WORDS.noGoogle;
  if (oauth === 'access_denied' || /user (denied|cancell?ed)|cancell?ed by (the )?user/.test(text)) return null;
  if (status >= 500 || code === 'unexpected_failure' || code === 'request_timeout' || /^hook_timeout/.test(code) || oauth === 'server_error') return ERROR_WORDS.server;
  return ERROR_WORDS.unknown;
}

/**
 * What to do when a request cannot be read, allowed or cancelled:
 * `signin` (the sign-in ran out), `expired` (the request is used up, timed
 * out, or belongs to another account) or `retry` (worth trying again).
 * @param {unknown} error
 * @returns {'signin' | 'expired' | 'retry'}
 */
export function classifyAuthorizationError(error) {
  const facts = factsOf(error);
  if (!facts) return 'retry';
  if (requestEnded(facts)) return 'expired';
  if (sessionGone(facts)) return 'signin';
  if (facts.status === 403 || facts.status === 404 || facts.status === 410) return 'expired';
  if (facts.status === 400 && facts.code === 'validation_failed') return 'expired';
  return 'retry';
}

/* ── Settings ─────────────────────────────────────────────────────────── */

const PLACEHOLDER = /your[-_ ]|<|>|\{\{|\}\}|xxxx|xyzcompany|example\.(com|org|net)|changeme|placeholder|todo|\.\.\./i;

/**
 * Whether a key is one that must never reach a browser: Supabase's secret
 * key, or a service-role key. A page that is handed one refuses to run.
 * @param {unknown} key
 * @returns {boolean}
 */
export function isSecretKey(key) {
  if (typeof key !== 'string') return false;
  const value = key.trim();
  if (/^sb_secret_/i.test(value)) return true;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const body = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, '=')));
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
}

/**
 * Whether the page has a real Supabase project to talk to: an https address
 * (http only on this device, for a local stack) and a public key, neither one
 * still a placeholder.
 * @param {ConsentConfig | null | undefined} config
 * @returns {boolean}
 */
export function hasConfiguredSupabase(config) {
  const address = typeof config?.supabaseUrl === 'string' ? config.supabaseUrl.trim() : '';
  const key = typeof config?.supabaseAnonKey === 'string' ? config.supabaseAnonKey.trim() : '';
  if (!address || !key || PLACEHOLDER.test(address) || PLACEHOLDER.test(key)) return false;
  const parsed = parseUrl(address);
  if (!parsed || !parsed.hostname) return false;
  const local = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) return false;
  return key.length >= 20 && !/\s/.test(key) && !isSecretKey(key);
}

/**
 * The page's settings: config.js, with any value a `<meta>` tag carries laid
 * over it. A missing or unsafe server address falls back to hyPer's.
 * @param {ConsentConfig | null | undefined} base What config.js set.
 * @param {ConsentConfig | null | undefined} [overrides] What the page's `<meta>` tags carry.
 * @returns {{ supabaseUrl: string, supabaseAnonKey: string, mcpUrl: string }}
 */
export function resolveConfig(base, overrides) {
  const pick = (/** @type {keyof ConsentConfig} */ name) => {
    const over = overrides?.[name];
    if (typeof over === 'string' && over.trim()) return over.trim();
    const own = base?.[name];
    return typeof own === 'string' ? own.trim() : '';
  };
  const mcpUrl = pick('mcpUrl');
  return {
    supabaseUrl: pick('supabaseUrl').replace(/\/+$/, ''),
    supabaseAnonKey: pick('supabaseAnonKey'),
    mcpUrl: parseUrl(mcpUrl)?.protocol === 'https:' ? mcpUrl : DEFAULT_MCP_URL,
  };
}

/* ── Preview ──────────────────────────────────────────────────────────── */

/**
 * The state `?preview=` asks to see, with sample words and nothing sent
 * anywhere. Never while the address names a request: a real connection always
 * wins.
 * @param {string | null | undefined} search
 * @returns {PreviewState | null}
 */
export function resolvePreview(search) {
  const params = paramsOf(search);
  if (params.has(AUTHORIZATION_PARAM)) return null;
  const asked = (params.get('preview') ?? '').trim().toLowerCase();
  return PREVIEW_STATES.find((state) => state === asked) ?? null;
}
