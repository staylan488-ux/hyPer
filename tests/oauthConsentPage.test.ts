import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { P_GLYPH } from '../native/src/lib/brandGeometry';
import {
  AUTHORIZATION_STORAGE_KEY,
  DEFAULT_MCP_URL,
  ERROR_WORDS,
  FORM_WORDS,
  PREVIEW_STATES,
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
  isSafeExternalUrl,
  isSafeRedirectUrl,
  isSecretKey,
  isValidAuthorizationId,
  persistAuthorizationId,
  readAuthReturnError,
  resolveAuthorizationId,
  resolveConfig,
  resolvePreview,
  safeRedirectTarget,
} from '../site/oauth/consent/logic.js';

// "Sign in with hyPer": the consent page an MCP client (Claude, ChatGPT, …)
// sends a person to. site/oauth/consent/logic.js holds its rules; the rest of
// this file reads the published files as text, because a mistake in them
// (markup built from an app's name, a missing header, a sign-out that reaches
// the phone) is one a browser would not report.

const SITE = path.resolve(__dirname, '../site');
const NATIVE = path.resolve(__dirname, '../native');
const read = (file: string) => readFileSync(path.join(SITE, file), 'utf8');

const REQUEST = 'q7Hx2mVbT4cLp9ZsKd0aYw3eRn6uJf8G';
const PAGE = 'https://thehyper.app/oauth/consent';

/** Storage that refuses everything, as a browser with site data blocked does. */
const blockedStorage = {
  getItem(): string | null {
    throw new Error('blocked');
  },
  setItem(): void {
    throw new Error('blocked');
  },
  removeItem(): void {
    throw new Error('blocked');
  },
};

function storageWith(id: string) {
  const storage = createMemoryStorage();
  storage.setItem(AUTHORIZATION_STORAGE_KEY, id);
  return storage;
}

describe('the request’s id', () => {
  it('accepts the ids Supabase makes and nothing that could leave the request path', () => {
    expect(isValidAuthorizationId(REQUEST)).toBe(true);
    expect(isValidAuthorizationId('3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f')).toBe(true);
    for (const bad of ['', '.', '..', '../../user', 'a/b', 'a?b=c', 'a#b', 'a b', 'a%2Fb', 'a\nb', '<script>', 'x'.repeat(257)]) {
      expect(isValidAuthorizationId(bad), bad).toBe(false);
    }
    for (const bad of [null, undefined, 42, {}, [REQUEST]]) expect(isValidAuthorizationId(bad)).toBe(false);
  });

  it('reads the request from the address', () => {
    expect(resolveAuthorizationId(`?authorization_id=${REQUEST}`, null)).toBe(REQUEST);
    expect(resolveAuthorizationId(`authorization_id=${REQUEST}&code=abc&state=xyz`)).toBe(REQUEST);
    expect(resolveAuthorizationId('', null)).toBeNull();
    expect(resolveAuthorizationId(null)).toBeNull();
  });

  it('falls back to the kept request when a sign-in dropped it from the address', () => {
    expect(resolveAuthorizationId('?code=abc', storageWith(REQUEST))).toBe(REQUEST);
    expect(resolveAuthorizationId('', storageWith('../../user'))).toBeNull();
  });

  it('prefers the address, and never swaps an unusable one for an older request', () => {
    expect(resolveAuthorizationId('?authorization_id=fresh-request', storageWith(REQUEST))).toBe('fresh-request');
    expect(resolveAuthorizationId('?authorization_id=..%2F..%2Fuser', storageWith(REQUEST))).toBeNull();
    expect(resolveAuthorizationId('?authorization_id=', storageWith(REQUEST))).toBeNull();
    expect(resolveAuthorizationId(`?authorization_id=${REQUEST}&authorization_id=other`, storageWith(REQUEST))).toBeNull();
  });

  it('keeps and forgets the request across a sign-in that leaves the page', () => {
    const storage = createMemoryStorage();
    expect(persistAuthorizationId(REQUEST, storage)).toBe(true);
    expect(storage.getItem(AUTHORIZATION_STORAGE_KEY)).toBe(REQUEST);
    expect(resolveAuthorizationId('', storage)).toBe(REQUEST);

    expect(persistAuthorizationId('../../user', storage)).toBe(false);
    expect(storage.getItem(AUTHORIZATION_STORAGE_KEY)).toBe(REQUEST);

    clearAuthorizationId(storage);
    expect(resolveAuthorizationId('', storage)).toBeNull();
  });

  it('survives a browser that refuses storage', () => {
    expect(resolveAuthorizationId('', blockedStorage)).toBeNull();
    expect(resolveAuthorizationId(`?authorization_id=${REQUEST}`, blockedStorage)).toBe(REQUEST);
    expect(persistAuthorizationId(REQUEST, blockedStorage)).toBe(false);
    expect(persistAuthorizationId(REQUEST, null)).toBe(false);
    expect(() => clearAuthorizationId(blockedStorage)).not.toThrow();
    expect(() => clearAuthorizationId(null)).not.toThrow();
  });
});

describe('the address a sign-in comes back to', () => {
  it('keeps the request and drops what an earlier attempt left behind', () => {
    const href = `${PAGE}/?authorization_id=${REQUEST}&code=stale&state=s&error=access_denied&error_description=nope&preview=consent#access_token=old`;
    expect(buildOAuthReturnUrl({ href }, REQUEST)).toBe(`${PAGE}/?authorization_id=${REQUEST}`);
  });

  it('adds the request back when a sign-in dropped it from the address', () => {
    expect(buildOAuthReturnUrl({ href: `${PAGE}?code=abc` }, REQUEST)).toBe(`${PAGE}?authorization_id=${REQUEST}`);
    expect(buildOAuthReturnUrl({ origin: 'https://thehyper.app', pathname: '/oauth/consent/' }, REQUEST)).toBe(`${PAGE}/?authorization_id=${REQUEST}`);
  });

  it('keeps the page’s own path, with or without the closing slash', () => {
    expect(buildOAuthReturnUrl({ href: `${PAGE}?authorization_id=x` }, REQUEST)).toBe(`${PAGE}?authorization_id=${REQUEST}`);
    expect(buildOAuthReturnUrl({ href: `${PAGE}/` }, REQUEST)).toBe(`${PAGE}/?authorization_id=${REQUEST}`);
  });

  it('never carries an unusable id, a sign-in in the address, or a non-web address', () => {
    expect(buildOAuthReturnUrl({ href: `${PAGE}/?authorization_id=x` }, '../../user')).toBe(`${PAGE}/`);
    expect(buildOAuthReturnUrl({ href: `${PAGE}/` }, null)).toBe(`${PAGE}/`);
    expect(buildOAuthReturnUrl({ href: 'https://someone:secret@thehyper.app/oauth/consent/' }, REQUEST)).toBe(`${PAGE}/?authorization_id=${REQUEST}`);
    expect(buildOAuthReturnUrl({ href: 'javascript:alert(1)' }, REQUEST)).toBe('');
    expect(buildOAuthReturnUrl({ href: 'not an address' }, REQUEST)).toBe('');
    expect(buildOAuthReturnUrl(null, REQUEST)).toBe('');
  });
});

describe('where the page may send someone', () => {
  const SCRIPT = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'about:blank',
    'blob:https://thehyper.app/0000',
    'view-source:https://thehyper.app',
    'intent://scan/#Intent;scheme=zxing;end',
  ];

  it('shows or links only web addresses', () => {
    expect(isSafeExternalUrl('https://claude.ai')).toBe(true);
    expect(isSafeExternalUrl('http://example.com/path?x=1')).toBe(true);
    for (const bad of [...SCRIPT, 'cursor://callback', 'mailto:a@b.c', '/relative', '//claude.ai', 'claude.ai', '', null, undefined, 7, {}]) {
      expect(isSafeExternalUrl(bad), String(bad)).toBe(false);
    }
  });

  it('returns to an agent over https, to this device over http, or to an app’s own scheme', () => {
    for (const good of [
      'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz',
      'https://chatgpt.com/connector_platform_oauth_redirect?code=abc',
      'http://localhost:53682/callback?code=abc',
      'http://127.0.0.1:8976/oauth/callback?code=abc',
      'http://[::1]:3000/cb?code=abc',
      'cursor://anysphere.cursor-mcp/oauth/callback?code=abc',
      'vscode://vscode.github-authentication/did-authenticate?code=abc',
    ]) {
      expect(isSafeRedirectUrl(good), good).toBe(true);
    }
  });

  it('refuses an address that runs as script, opens a local page, or is plain http elsewhere', () => {
    for (const bad of [...SCRIPT, 'http://example.com/callback?code=abc', 'ws://localhost/cb', 'mailto:a@b.c', '/callback?code=abc', '//evil.example/cb', 'https://', '', '   ', null, undefined, 7, { href: 'https://claude.ai' }]) {
      expect(isSafeRedirectUrl(bad), String(bad)).toBe(false);
      expect(safeRedirectTarget(bad)).toBeNull();
    }
  });

  it('hands back the address in the browser’s own spelling', () => {
    expect(safeRedirectTarget('  https://CLAUDE.ai/cb?code=a b ')).toBe('https://claude.ai/cb?code=a%20b');
    expect(safeRedirectTarget('cursor://anysphere.cursor-mcp/oauth/callback?code=abc')).toBe('cursor://anysphere.cursor-mcp/oauth/callback?code=abc');
  });
});

describe('who is asking', () => {
  it('names the host the approval goes back to', () => {
    expect(formatClientOrigin({ authorization_id: REQUEST, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' })).toBe('claude.ai');
    expect(formatClientOrigin({ redirect_uri: 'https://www.ChatGPT.com/connector_platform_oauth_redirect' })).toBe('chatgpt.com');
    expect(formatClientOrigin({ redirect_uri: 'http://localhost:53682/callback' })).toBe('this device');
    expect(formatClientOrigin({ redirect_uri: 'http://127.0.0.1:8976/cb' })).toBe('this device');
  });

  it('trusts the return address over the website an app claims', () => {
    const spoof = { authorization_id: REQUEST, redirect_uri: 'https://evil.example/cb', client: { name: 'Claude', uri: 'https://claude.ai' } };
    expect(formatClientOrigin(spoof)).toBe('evil.example');
    // A look-alike name shows in its encoded form, not as the letters it imitates.
    expect(formatClientOrigin({ redirect_uri: 'https://clаude.ai/cb' })).toMatch(/^xn--/);
    expect(formatClientOrigin({ redirect_uri: 'https://claude.ai@evil.example/cb' })).toBe('evil.example');
  });

  it('says nothing for an app scheme rather than vouch for a claimed website', () => {
    expect(formatClientOrigin({ redirect_uri: 'cursor://anysphere.cursor-mcp/oauth/callback', client: { uri: 'https://cursor.com' } })).toBeNull();
    expect(formatClientOrigin({ redirect_uri: 'javascript:alert(1)', client: { uri: 'https://claude.ai' } })).toBeNull();
  });

  it('reads a client given alone by its website, and refuses anything that is not a web address', () => {
    expect(formatClientOrigin({ uri: 'https://claude.ai/' })).toBe('claude.ai');
    expect(formatClientOrigin({ client: { uri: 'https://www.cursor.com' } })).toBe('cursor.com');
    for (const uri of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'claude.ai', '']) {
      expect(formatClientOrigin({ uri }), uri).toBeNull();
    }
    expect(formatClientOrigin(null)).toBeNull();
    expect(formatClientOrigin(undefined)).toBeNull();
    expect(formatClientOrigin({})).toBeNull();
  });

  it('shows an app’s name as one plain line', () => {
    expect(formatClientName('Claude')).toBe('Claude');
    expect(formatClientName('  Claude \n Code  ')).toBe('Claude Code');
    // Right-to-left override and zero-width characters can dress one name up as another.
    expect(formatClientName('Cl​aude‮edoc')).toBe('Claudeedoc');
    expect(formatClientName('<b>Claude</b>')).toBe('<b>Claude</b>');
    const long = formatClientName('A'.repeat(200));
    expect(long).toHaveLength(40);
    expect(long?.endsWith('…')).toBe(true);
    for (const empty of ['', '   ', '​‮', null, undefined, 42, {}]) expect(formatClientName(empty)).toBeNull();
  });

  it('says what the requested scopes share about the person', () => {
    expect(describeScopes('openid email profile')).toEqual({ identity: 'See your name and email address', others: [] });
    expect(describeScopes('openid email')).toEqual({ identity: 'See your email address', others: [] });
    expect(describeScopes('profile')).toEqual({ identity: 'See your name', others: [] });
    expect(describeScopes('openid profile email phone').identity).toBe('See your name, email address and phone number');
    expect(describeScopes('openid')).toEqual({ identity: null, others: [] });
    expect(describeScopes('')).toEqual({ identity: null, others: [] });
    expect(describeScopes(undefined)).toEqual({ identity: null, others: [] });
  });

  it('keeps scopes it has no words for, so nothing asked for is hidden', () => {
    expect(describeScopes('openid email offline_access  offline_access mcp:tools')).toEqual({
      identity: 'See your email address',
      others: ['offline_access', 'mcp:tools'],
    });
    expect(describeScopes('a b c d e f g').others).toHaveLength(5);
    expect(describeScopes(`ok ${'x'.repeat(41)} bad"quote`).others).toEqual(['ok']);
  });
});

describe('what Supabase answered', () => {
  const details = {
    authorization_id: REQUEST,
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    client: { id: 'c1', name: 'Claude', uri: 'https://claude.ai', logo_uri: '' },
    user: { id: 'u1', email: 'you@example.com' },
    scope: 'openid email profile',
  };

  it('tells a request that needs a yes or no from one already allowed', () => {
    expect(classifyAuthorizationResponse(details)).toEqual({ kind: 'consent', details });
    expect(classifyAuthorizationResponse({ redirect_url: 'https://claude.ai/cb?code=abc' })).toEqual({
      kind: 'redirect',
      redirectUrl: 'https://claude.ai/cb?code=abc',
    });
  });

  it('asks rather than returns when an answer carries both', () => {
    expect(classifyAuthorizationResponse({ ...details, redirect_url: 'https://claude.ai/cb' }).kind).toBe('consent');
  });

  it('treats anything else as no answer', () => {
    for (const odd of [null, undefined, '', 'https://claude.ai/cb', 7, [], [details], {}, { redirect_url: '' }, { redirect_url: 7 }, { authorization_id: '' }, { authorization_id: 7 }]) {
      expect(classifyAuthorizationResponse(odd)).toEqual({ kind: 'invalid' });
    }
  });

  it('knows a request that is used up, timed out or someone else’s', () => {
    expect(classifyAuthorizationError({ status: 404, code: 'oauth_authorization_not_found', message: 'authorization not found' })).toBe('expired');
    expect(classifyAuthorizationError({ status: 400, code: 'validation_failed', message: 'authorization request cannot be processed' })).toBe('expired');
    expect(classifyAuthorizationError({ status: 400, message: 'authorization request is no longer pending' })).toBe('expired');
    expect(classifyAuthorizationError({ status: 410 })).toBe('expired');
    expect(classifyAuthorizationError({ status: 403 })).toBe('expired');
  });

  it('knows a sign-in that ran out', () => {
    expect(classifyAuthorizationError({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe('signin');
    expect(classifyAuthorizationError({ status: 401, code: 'bad_jwt', message: 'invalid JWT' })).toBe('signin');
    expect(classifyAuthorizationError({ status: 403, code: 'session_not_found' })).toBe('signin');
  });

  it('retries everything else', () => {
    expect(classifyAuthorizationError(new TypeError('Failed to fetch'))).toBe('retry');
    expect(classifyAuthorizationError({ status: 500, code: 'unexpected_failure' })).toBe('retry');
    expect(classifyAuthorizationError({ status: 400, code: 'bad_json' })).toBe('retry');
    expect(classifyAuthorizationError(null)).toBe('retry');
  });
});

describe('failures, said plainly', () => {
  it('uses the app’s own words for the common ones', () => {
    expect(friendlyAuthError({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(ERROR_WORDS.wrongPassword);
    expect(friendlyAuthError(new Error('Invalid login credentials'))).toBe('That email and password don’t match. Check them and try again.');
    expect(friendlyAuthError({ status: 429, message: 'Request rate limit reached' })).toBe('Too many tries for now. Wait a minute, then try again.');
    expect(friendlyAuthError({ code: 'over_request_rate_limit' })).toBe(ERROR_WORDS.tooMany);
    expect(friendlyAuthError(new TypeError('Failed to fetch'))).toBe('Couldn’t reach hyPer. Check your connection and try again.');
    expect(friendlyAuthError(new TypeError('Load failed'))).toBe(ERROR_WORDS.offline);
    expect(friendlyAuthError(new Error('timed out'))).toBe(ERROR_WORDS.offline);
    expect(friendlyAuthError({ name: 'AuthRetryableFetchError', message: '' })).toBe(ERROR_WORDS.offline);
  });

  it('says an email has no account however the refusal is worded', () => {
    for (const message of ['Database error saving new user', 'Signups not allowed for this instance', 'hyPer is invite-only', 'Email not invited']) {
      expect(friendlyAuthError({ message }), message).toBe(ERROR_WORDS.noAccount);
    }
    expect(friendlyAuthError({ error: 'access_denied', code: 'signup_disabled', description: 'Signups not allowed' })).toBe(ERROR_WORDS.noAccount);
    expect(friendlyAuthError({ error: 'server_error', code: 'unexpected_failure', description: 'Database error saving new user' })).toBe(ERROR_WORDS.noAccount);
  });

  it('covers the rest of sign-in and the request itself', () => {
    expect(friendlyAuthError({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toBe(ERROR_WORDS.unconfirmed);
    expect(friendlyAuthError({ code: 'user_banned' })).toBe(ERROR_WORDS.blocked);
    expect(friendlyAuthError({ status: 404, code: 'oauth_authorization_not_found', message: 'authorization not found' })).toBe(ERROR_WORDS.requestEnded);
    expect(friendlyAuthError({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe(ERROR_WORDS.signedOut);
    expect(friendlyAuthError({ status: 401, message: 'invalid JWT' })).toBe(ERROR_WORDS.signedOut);
    expect(friendlyAuthError({ code: 'bad_code_verifier', message: 'code challenge does not match' })).toBe(ERROR_WORDS.unfinished);
    expect(friendlyAuthError({ code: 'flow_state_expired' })).toBe(ERROR_WORDS.unfinished);
    expect(friendlyAuthError({ code: 'provider_disabled', message: 'Unsupported provider: provider is not enabled' })).toBe(ERROR_WORDS.noGoogle);
    expect(friendlyAuthError({ status: 500, message: 'Internal Server Error' })).toBe(ERROR_WORDS.server);
    expect(friendlyAuthError({ status: 400, message: 'something new' })).toBe(ERROR_WORDS.unknown);
    expect(friendlyAuthError(42)).toBe(ERROR_WORDS.unknown);
  });

  it('says nothing when there is nothing to say', () => {
    expect(friendlyAuthError(null)).toBeNull();
    expect(friendlyAuthError(undefined)).toBeNull();
    expect(friendlyAuthError('')).toBeNull();
    // Backing out of Google's sheet is a choice, not a failure.
    expect(friendlyAuthError({ error: 'access_denied', code: '', description: 'The user denied access' })).toBeNull();
  });

  it('never repeats words from the address or the server', () => {
    const allowed = new Set<string | null>([...Object.values(ERROR_WORDS), null]);
    const planted = 'Call 0800 SCAM now <script>alert(1)</script>';
    const attempts: unknown[] = [
      planted,
      new Error(planted),
      { message: planted, status: 400 },
      { error: 'x', code: 'y', description: planted },
      { error: planted, description: planted, code: planted },
      readAuthReturnError(`?error=server_error&error_description=${encodeURIComponent(planted)}`, ''),
      readAuthReturnError('', `#error_description=${encodeURIComponent(planted)}&error_code=${encodeURIComponent(planted)}`),
    ];
    for (const attempt of attempts) {
      const words = friendlyAuthError(attempt);
      expect(allowed.has(words)).toBe(true);
      expect(words ?? '').not.toContain('SCAM');
    }
  });

  it('reads what a sign-in left in the address, from the query or the fragment', () => {
    expect(readAuthReturnError('?error=access_denied&error_code=otp_expired&error_description=Link+expired', '')).toEqual({
      error: 'access_denied',
      code: 'otp_expired',
      description: 'Link expired',
    });
    expect(readAuthReturnError('', '#error=server_error&error_description=Database+error+saving+new+user')).toEqual({
      error: 'server_error',
      code: '',
      description: 'Database error saving new user',
    });
    expect(readAuthReturnError(`?authorization_id=${REQUEST}&code=abc`, '')).toBeNull();
    expect(readAuthReturnError(null, null)).toBeNull();
    expect(readAuthReturnError(`?error_description=${'x'.repeat(5000)}`)?.description).toHaveLength(300);
  });

  it('says what the form still needs before it is sent', () => {
    expect(checkSignInForm('', '')).toEqual({ field: 'email', message: FORM_WORDS.needEmail });
    expect(checkSignInForm('   ', 'correct-horse')).toEqual({ field: 'email', message: 'Enter your email.' });
    expect(checkSignInForm('you@example.com', '')).toEqual({ field: 'password', message: 'Enter your password.' });
    expect(checkSignInForm('you@example.com', '12345')).toEqual({ field: 'password', message: 'Use at least 6 characters.' });
    expect(checkSignInForm('you@example.com', '123456')).toBeNull();
    expect(checkSignInForm(null, undefined)).toEqual({ field: 'email', message: FORM_WORDS.needEmail });
  });
});

describe('the page’s settings', () => {
  const jwt = (claims: object) => `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify(claims))}.signature`.replace(/=/g, '');
  const anonKey = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon' });
  const serviceKey = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'service_role' });
  const project = 'https://abcdefghijklmnopqrst.supabase.co';

  it('needs a real project address and a public key', () => {
    expect(hasConfiguredSupabase({ supabaseUrl: project, supabaseAnonKey: anonKey })).toBe(true);
    expect(hasConfiguredSupabase({ supabaseUrl: project, supabaseAnonKey: 'sb_publishable_0123456789abcdefghij' })).toBe(true);
    expect(hasConfiguredSupabase({ supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: anonKey })).toBe(true);
  });

  it('is not set up while a value is empty or still a placeholder', () => {
    for (const config of [
      null,
      undefined,
      {},
      { supabaseUrl: '', supabaseAnonKey: '' },
      { supabaseUrl: project, supabaseAnonKey: '' },
      { supabaseUrl: '', supabaseAnonKey: anonKey },
      { supabaseUrl: '   ', supabaseAnonKey: '   ' },
      { supabaseUrl: 'https://YOUR_PROJECT.supabase.co', supabaseAnonKey: anonKey },
      { supabaseUrl: 'https://your-project.supabase.co', supabaseAnonKey: anonKey },
      { supabaseUrl: 'https://xyzcompany.supabase.co', supabaseAnonKey: anonKey },
      { supabaseUrl: 'https://<project-ref>.supabase.co', supabaseAnonKey: anonKey },
      { supabaseUrl: project, supabaseAnonKey: 'YOUR_ANON_KEY_YOUR_ANON_KEY' },
      { supabaseUrl: project, supabaseAnonKey: 'your-anon-key-goes-here-please' },
      { supabaseUrl: project, supabaseAnonKey: 'short' },
      { supabaseUrl: project, supabaseAnonKey: 'a key with spaces in the middle' },
      { supabaseUrl: 'http://abcdefghijklmnopqrst.supabase.co', supabaseAnonKey: anonKey },
      { supabaseUrl: 'abcdefghijklmnopqrst.supabase.co', supabaseAnonKey: anonKey },
      { supabaseUrl: 'javascript:alert(1)', supabaseAnonKey: anonKey },
    ]) {
      expect(hasConfiguredSupabase(config), JSON.stringify(config)).toBe(false);
    }
  });

  it('refuses a key that must never reach a browser', () => {
    expect(isSecretKey(serviceKey)).toBe(true);
    expect(isSecretKey('sb_secret_0123456789abcdefghij')).toBe(true);
    expect(isSecretKey(anonKey)).toBe(false);
    expect(isSecretKey('sb_publishable_0123456789abcdefghij')).toBe(false);
    expect(isSecretKey('not.a.jwt')).toBe(false);
    expect(isSecretKey(undefined)).toBe(false);
    expect(hasConfiguredSupabase({ supabaseUrl: project, supabaseAnonKey: serviceKey })).toBe(false);
    expect(hasConfiguredSupabase({ supabaseUrl: project, supabaseAnonKey: 'sb_secret_0123456789abcdefghij' })).toBe(false);
  });

  it('lays a meta tag’s value over config.js and falls back to hyPer’s server address', () => {
    const base = { supabaseUrl: `${project}/`, supabaseAnonKey: ` ${anonKey} `, mcpUrl: 'https://mcp.thehyper.app' };
    expect(resolveConfig(base, { supabaseUrl: '', supabaseAnonKey: '', mcpUrl: '' })).toEqual({
      supabaseUrl: project,
      supabaseAnonKey: anonKey,
      mcpUrl: 'https://mcp.thehyper.app',
    });
    expect(resolveConfig(base, { supabaseUrl: 'https://other.supabase.co' }).supabaseUrl).toBe('https://other.supabase.co');
    expect(resolveConfig(undefined, undefined)).toEqual({ supabaseUrl: '', supabaseAnonKey: '', mcpUrl: DEFAULT_MCP_URL });
    for (const mcpUrl of ['javascript:alert(1)', 'http://mcp.thehyper.app', 'mcp.thehyper.app', '']) {
      expect(resolveConfig({ mcpUrl }).mcpUrl, mcpUrl).toBe(DEFAULT_MCP_URL);
    }
  });

  it('ships config.js with no secret in it', () => {
    const config = read('oauth/consent/config.js');
    expect(config).toContain('window.HYPER_OAUTH_CONFIG');
    expect(config).not.toMatch(/sb_secret_/i);
    for (const [, value] of config.matchAll(/:\s*'([^']*)'/g)) expect(isSecretKey(value)).toBe(false);
    expect(config).toMatch(/mcpUrl: 'https:\/\/[^']+'/);
  });
});

describe('preview', () => {
  it('shows a state only when asked, and only one it knows', () => {
    for (const state of PREVIEW_STATES) expect(resolvePreview(`?preview=${state}`)).toBe(state);
    expect(PREVIEW_STATES).toEqual(expect.arrayContaining(['signin', 'consent', 'direct', 'error', 'loading']));
    expect(resolvePreview('?preview=CONSENT')).toBe('consent');
    expect(resolvePreview('')).toBeNull();
    expect(resolvePreview('?preview=')).toBeNull();
    expect(resolvePreview('?preview=admin')).toBeNull();
    expect(resolvePreview(null)).toBeNull();
  });

  it('never takes the place of a real request', () => {
    expect(resolvePreview(`?preview=consent&authorization_id=${REQUEST}`)).toBeNull();
    expect(resolvePreview(`?authorization_id=${REQUEST}&preview=signin`)).toBeNull();
    expect(resolvePreview('?preview=consent&authorization_id=')).toBeNull();
  });
});

/* ── The published files ──────────────────────────────────────────────── */

/** Source with its comments taken out, so a rule's own explanation cannot trip it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const page = read('oauth/consent/index.html');
const landing = read('index.html');
const logic = read('oauth/consent/logic.js');
const consent = read('oauth/consent/consent.js');
const consentCss = read('oauth/consent/consent.css');
const blancCss = read('assets/blanc.css');

describe('the page’s scripts', () => {
  const scripts = { 'logic.js': code(logic), 'consent.js': code(consent), 'config.js': code(read('oauth/consent/config.js')) };

  it('never build markup from text', () => {
    const markup = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser|srcdoc|\beval\s*\(|new Function|setAttribute\(\s*['"]on/;
    for (const [name, source] of Object.entries(scripts)) expect(source, name).not.toMatch(markup);
    // What an app or an account supplies goes in as text.
    for (const target of ['consentTitle', 'consentLead', 'consentOrigin', 'consentIdentity', 'consentScopes', 'who', 'problemBody', 'directTitle']) {
      expect(scripts['consent.js'], target).toMatch(new RegExp(`\\b${target}\\.textContent = `));
    }
  });

  it('keep logic.js free of the browser, so these tests can load it', () => {
    expect(scripts['logic.js']).not.toMatch(/\b(window|document|navigator|localStorage|sessionStorage|location|history)\s*[.[(]/);
    expect(scripts['logic.js']).not.toMatch(/^\s*import\s/m);
  });

  it('only ever sign out of this tab', () => {
    const signOuts = [...scripts['consent.js'].matchAll(/\.signOut\(([^)]*)\)/g)].map((match) => match[1]);
    expect(signOuts.length).toBeGreaterThan(0);
    // The default scope signs the person out everywhere, their iPhone included.
    for (const args of signOuts) expect(args).toBe("{ scope: 'local' }");
  });

  it('keep the sign-in in this tab, away from the rest of the site', () => {
    expect(scripts['consent.js']).not.toMatch(/localStorage/);
    expect(scripts['consent.js']).toMatch(/window\.sessionStorage/);
    expect(scripts['consent.js']).toMatch(/storage: state\.storage/);
  });

  it('check the return address themselves before opening it', () => {
    const source = scripts['consent.js'];
    expect(source).toMatch(/approveAuthorization\(state\.authorizationId, \{ skipBrowserRedirect: true \}\)/);
    expect(source).toMatch(/denyAuthorization\(state\.authorizationId, \{ skipBrowserRedirect: true \}\)/);
    expect(source).toMatch(/const target = safeRedirectTarget\(redirectUrl\);/);
    expect(source).toMatch(/window\.location\.replace\(target\)/);
    // The one way out of the page is the checked one.
    expect(source).not.toMatch(/location\.href\s*=[^=]|location\.assign\(|window\.open\(/);
    expect(source.match(/location\.replace\(/g)).toHaveLength(1);
  });

  it('refuse to ask inside another page’s frame', () => {
    expect(scripts['consent.js']).toMatch(/window\.top !== window\.self/);
  });

  it('load one exact version of the Supabase client, and sign in with PKCE', () => {
    const versions = [...scripts['consent.js'].matchAll(/https:\/\/esm\.sh\/@supabase\/supabase-js@([^'"]+)/g)].map((match) => match[1]);
    // A floating version would let the page's sign-in code change under it.
    expect(versions).toEqual(['2.115.0']);
    expect(scripts['consent.js']).toMatch(/flowType: 'pkce'/);
  });
});

describe('the consent page', () => {
  it('has no inline script, style or handler, which its headers would block', () => {
    expect(page).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(page).not.toMatch(/<style[\s>]/);
    expect(page).not.toMatch(/\sstyle=/);
    expect(page).not.toMatch(/\son[a-z]+\s*=/i);
    expect(page).not.toMatch(/javascript:/i);
  });

  it('names every file from the site’s root, so it works with or without the closing slash', () => {
    const local = [...page.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((match) => match[1]).filter((target) => !/^https:\/\//.test(target));
    expect(local.length).toBeGreaterThanOrEqual(5);
    for (const target of local) expect(target, target).toMatch(/^\//);
    for (const target of local) expect(() => read(target.slice(1))).not.toThrow();
  });

  it('is kept out of search, referrers and a credentials-in-the-address mistake', () => {
    expect(page).toMatch(/<meta name="robots" content="noindex, nofollow">/);
    expect(page).toMatch(/<meta name="referrer" content="no-referrer">/);
    // If the script never ran, the browser must not send a password in the address.
    expect(page).toMatch(/<form[^>]*\smethod="post"/);
    expect(page).toMatch(/<section class="view" data-view="signin"[^>]*\shidden>/);
  });

  it('labels its fields for people, password managers and iPhone keyboards', () => {
    expect(page).toMatch(/<label for="email">Email<\/label>/);
    expect(page).toMatch(/<label for="password">Password<\/label>/);
    expect(page).toMatch(/<input id="email"[^>]*type="email"[^>]*autocomplete="username"[^>]*autocapitalize="none"/);
    expect(page).toMatch(/<input id="password"[^>]*type="password"[^>]*autocomplete="current-password"/);
    // Under 16 px, Safari on iPhone zooms the page when a field is tapped.
    expect(consentCss).toMatch(/\.field input \{[^}]*font-size: max\(1rem, 16px\);/);
  });

  it('announces what changes, and starts every view on a heading', () => {
    expect(page).toMatch(/id="announcer" role="status" aria-live="polite"/);
    expect(page).toMatch(/<main class="page" id="main"/);
    for (const view of ['signin', 'consent', 'direct', 'problem']) {
      expect(page, view).toMatch(new RegExp(`data-view="${view}" aria-labelledby="${view}-title"`));
      expect(page, view).toMatch(new RegExp(`<h1 class="t-title" id="${view}-title" tabindex="-1">`));
    }
  });

  it('says what hyPer’s server lets an agent do', () => {
    for (const line of [
      'Read your food diary, daily targets and recent weigh-ins',
      'Search your saved foods and meals',
      'Log food and weigh-ins, and edit or delete food entries',
      'You can disconnect anytime from hyPer.',
      'Continue with Google',
      'Allow access',
      'Cancel',
      'Switch account',
    ]) {
      expect(page, line).toContain(line);
    }
  });

  // The MCP server is its own piece of work; where it is present, the two are held together.
  const toolsFile = path.resolve(__dirname, '../supabase/functions/mcp/tools.ts');

  it.skipIf(!existsSync(toolsFile))('matches the tools the MCP server offers', () => {
    const tools = readFileSync(toolsFile, 'utf8');
    const names = [...tools.matchAll(/^\s{4}name: '([a-z_]+)',$/gm)].map((match) => match[1]).sort();
    // A new tool means the list of what an agent can do needs another look.
    expect(names).toEqual(['delete_food_log', 'get_day_summary', 'log_body_weight', 'log_food', 'search_foods', 'update_food_log']);
  });
});

describe('response headers', () => {
  function rules(): Map<string, Map<string, string>> {
    const found = new Map<string, Map<string, string>>();
    let current: Map<string, string> | null = null;
    for (const line of read('_headers').split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      if (!/^\s/.test(line)) {
        current = new Map();
        found.set(line.trim(), current);
      } else if (current) {
        const at = line.indexOf(':');
        current.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
      }
    }
    return found;
  }

  const directives = (policy: string) =>
    new Map(policy.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values] as const));

  it.each(['/oauth/consent', '/oauth/consent/*'])('stop %s being framed, cached or leaked', (pattern) => {
    const headers = rules().get(pattern);
    expect(headers, pattern).toBeDefined();
    expect(headers?.get('x-frame-options')).toBe('DENY');
    expect(headers?.get('referrer-policy')).toBe('no-referrer');
    expect(headers?.get('x-content-type-options')).toBe('nosniff');
    expect(headers?.get('cache-control')).toBe('no-store');

    const policy = directives(headers?.get('content-security-policy') ?? '');
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('default-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'none'"]);
    // Scripts from this site and the pinned Supabase client's host, nothing inline,
    // and requests to Supabase alone.
    expect(policy.get('script-src')).toEqual(["'self'", 'https://esm.sh']);
    expect(policy.get('style-src')).toEqual(["'self'"]);
    expect(policy.get('img-src')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(['https://auth.thehyper.app', 'https://*.supabase.co']);
    expect(headers?.get('content-security-policy')).not.toMatch(/unsafe-inline|unsafe-eval|\*\s*;|\s\*$/);
  });

  it('give both spellings of the page’s address the same headers', () => {
    const found = rules();
    expect([...(found.get('/oauth/consent') ?? [])]).toEqual([...(found.get('/oauth/consent/*') ?? [])]);
  });
});

describe('Blanc on the web', () => {
  /** `ground: '#F2F1ED'` pairs of one palette in native/src/theme/blanc.ts. */
  function appPalette(name: string): Record<string, string> {
    const theme = readFileSync(path.join(NATIVE, 'src/theme/blanc.ts'), 'utf8');
    const palettes = theme.slice(theme.indexOf('export const palettes = {'), theme.indexOf('} as const;'));
    const block = palettes.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`));
    expect(block, name).not.toBeNull();
    return Object.fromEntries([...(block?.[1] ?? '').matchAll(/^\s+(\w+): '([^']+)',$/gm)].map((match) => [match[1], match[2]]));
  }

  /** `--ground: #F2F1ED;` pairs of the `:root` block under an at-rule (or the first, bare one). */
  function sitePalette(media: string | null): Record<string, string> {
    const escaped = media?.replace(/[()]/g, '\\$&');
    const block = blancCss.match(media ? new RegExp(`@media ${escaped} \\{\\s*:root \\{([^}]*)\\}`) : /^:root \{([^}]*)\}/m);
    expect(block, media ?? ':root').not.toBeNull();
    return Object.fromEntries([...(block?.[1] ?? '').matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  }

  const kebab = (key: string) => `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

  it.each([
    ['light', null],
    ['dark', '(prefers-color-scheme: dark)'],
    ['lightContrast', '(prefers-contrast: more)'],
    ['darkContrast', '(prefers-color-scheme: dark) and (prefers-contrast: more)'],
  ])('uses the app’s %s palette, colour for colour', (name, media) => {
    const app = appPalette(name);
    const site = sitePalette(media);
    expect(Object.keys(app).length).toBeGreaterThanOrEqual(18);
    for (const [key, value] of Object.entries(app)) expect(site[kebab(key)], `${name}.${key}`).toBe(value);
  });

  it('draws the same P everywhere, at the size and shape the app’s font gives it', () => {
    const outline = (source: string) => source.match(/<path[^>]*\sd="(M[^"]+Z)"/)?.[1] ?? '';
    const mark = outline(page);
    expect(outline(landing)).toBe(mark);
    expect(outline(read('assets/images/favicon.svg'))).toBe(mark);

    // The outline is Fraunces Mark Medium Italic's P in font units (2000 to the
    // em), moved so its ink starts at 0, 0. The app's own record of that glyph
    // (brandGeometry) gives its width; its height is the 1400-unit cap height.
    const inkWidth = (P_GLYPH.inkRight - P_GLYPH.inkLeft) * 2000;
    const points = [...mark.matchAll(/[MLQ]?\s*(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
    expect(points.length).toBeGreaterThan(100);
    expect(Math.min(...points.map(([x]) => x))).toBe(0);
    expect(Math.min(...points.map(([, y]) => y))).toBe(0);
    expect(Math.max(...points.map(([, y]) => y))).toBe(1400);
    // The widest point is a curve's handle, a little outside the ink it bends.
    expect(Math.max(...points.map(([x]) => x))).toBeGreaterThanOrEqual(Math.floor(inkWidth));
    expect(Math.max(...points.map(([x]) => x))).toBeLessThan(inkWidth + 12);
    expect(page).toMatch(new RegExp(`<svg class="mark" viewBox="0 0 ${Math.ceil(inkWidth)} 1400" role="img" aria-label="hyPer"`));

    // Drawn at the app's emblem size, where a 48 pt P has ink this wide and tall.
    const emblem = Number(readFileSync(path.join(NATIVE, 'src/components/BrandMark.tsx'), 'utf8').match(/EMBLEM_MARK_SIZE = (\d+);/)?.[1]);
    expect(emblem).toBe(48);
    const px = (units: number) => `${Math.round((units / 2000) * emblem * 10) / 10}px`;
    expect(blancCss).toMatch(new RegExp(`\\.mark \\{[^}]*width: ${px(inkWidth)};[^}]*height: ${px(1400)};[^}]*fill: var\\(--brand\\);`));

    for (const [site, app] of [
      ['assets/fonts/FrauncesMark-MediumItalic.ttf', 'assets/fonts/FrauncesMark-MediumItalic.ttf'],
      ['assets/fonts/Fraunces-OFL.txt', 'assets/fonts/Fraunces-OFL.txt'],
      ['assets/images/google-g.svg', 'assets/images/google-g.svg'],
    ]) {
      expect(readFileSync(path.join(SITE, site)).equals(readFileSync(path.join(NATIVE, app))), site).toBe(true);
    }
    expect(consentCss).toContain('url("/assets/images/google-g.svg")');
  });

  it('keeps Blanc’s restraint: no gradients, no drop shadows, no serif, no capitals, one red', () => {
    const landingStyle = landing.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    for (const [name, css] of [['blanc.css', code(blancCss)], ['consent.css', code(consentCss)], ['index.html', code(landingStyle)]] as const) {
      expect(css, name).not.toMatch(/gradient\(/);
      expect(css, name).not.toMatch(/text-transform/);
      // The P is an outline, so no page names a serif face at all.
      expect(css.replace(/sans-serif/g, ''), name).not.toMatch(/serif|Georgia|Times|Fraunces|Garamond|@font-face/i);
      // A shadow here only ever draws a line: an inset ring or a rule, never a blur.
      for (const [, shadow] of css.matchAll(/box-shadow:\s*([^;]+);/g)) {
        expect(shadow, `${name}: ${shadow}`).toMatch(/^(inset 0 0 0 [\d.]+px var\(--[\w-]+\)|0 [\d.]+px 0 0 var\(--[\w-]+\)|0 0 0 100px var\(--ground\) inset)$/);
      }
      // Colours come from the palette; the page names none of its own.
      const own = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((match) => match[0]);
      if (name !== 'blanc.css') expect(own.filter((colour) => !/^#(F2F1ED|000000)$/i.test(colour)), name).toEqual([]);
    }
  });

  it('follows Reduce Motion, Increase Contrast and dark, with 44 px targets and a visible focus', () => {
    expect(consentCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(consentCss).toMatch(/@media \(prefers-contrast: more\)/);
    expect(blancCss).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(blancCss).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--ink\);/);
    expect(consentCss).toMatch(/\.capsule \{[^}]*min-height: 54px;/);
    expect(consentCss).toMatch(/\.link \{[^}]*min-height: 44px;/);
    expect(consentCss).toMatch(/\.capsule--small::after \{[^}]*inset: -4px 0;/);
  });
});
