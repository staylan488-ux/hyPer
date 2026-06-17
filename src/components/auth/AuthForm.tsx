import { useCallback, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input } from '@/components/shared';
import { LoginMonolithIntro } from '@/components/intro/LoginMonolithIntro';
import { markLoginIntroPlayed, shouldPlayLoginIntro } from '@/components/intro/introState';
import { springs } from '@/lib/animations';

const SIGNUP_SUCCESS_MESSAGE = 'Account created. Check your email to verify before signing in.';

export function AuthForm() {
  const reduceMotion = useReducedMotion();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [signupButtonLocked, setSignupButtonLocked] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [showIntro, setShowIntro] = useState(() => shouldPlayLoginIntro() && !reduceMotion);

  const { signIn, signUp, resendSignupConfirmation, signInWithGoogle, loading } = useAuthStore();

  const clearSignupSignals = useCallback(() => {
    setSignupSuccess(null);
    setPendingVerificationEmail(null);
    setShowSignInPrompt(false);
    setSignupButtonLocked(false);
  }, []);

  const switchToLogin = useCallback(() => {
    clearSignupSignals();
    setIsLogin(true);
    setError(null);
  }, [clearSignupSignals]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isLogin) {
      clearSignupSignals();
      const { error } = await signIn(email, password);
      if (error) setError(error.message);
      return;
    }

    if (signupButtonLocked) return;

    const { error, existingAccount } = await signUp(email, password, displayName);
    if (error) {
      setError(error.message);
      setShowSignInPrompt(existingAccount);
      setSignupSuccess(null);
      setPendingVerificationEmail(null);
      setSignupButtonLocked(false);
      return;
    }

    setSignupSuccess(SIGNUP_SUCCESS_MESSAGE);
    setPendingVerificationEmail(email);
    setShowSignInPrompt(false);
    setSignupButtonLocked(true);
    setDisplayName('');
    setPassword('');
  };

  const handleGoogleSignIn = async () => {
    clearSignupSignals();
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) setError(error.message);
  };

  const handleResendVerification = async () => {
    const targetEmail = pendingVerificationEmail || email;
    if (!targetEmail || resendingVerification) return;

    setResendingVerification(true);
    setError(null);

    try {
      const { error } = await resendSignupConfirmation(targetEmail);
      if (error) {
        setError(error.message);
        return;
      }

      setSignupSuccess(`Verification email resent to ${targetEmail}. Check spam or promotions if it doesn't appear.`);
    } finally {
      setResendingVerification(false);
    }
  };

  const finishIntro = useCallback(() => {
    markLoginIntroPlayed();
    setShowIntro(false);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-base)] flex flex-col justify-center px-7 py-14">
      <motion.div
        className="w-full max-w-[26rem] mx-auto"
        initial={showIntro ? { opacity: 0, y: 16 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={showIntro ? { duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 1.1 } : springs.smooth}
      >
        {/* ─── Masthead ─── */}
        <header>
          <div className="flex items-baseline justify-between">
            <span className="t-label-sm">A field journal</span>
            <span className="t-label-sm">Est. MMXXVI</span>
          </div>
          <div className="border-t border-[var(--color-text)] mt-3 pt-6">
            <h1 className="[font-family:var(--font-display)] text-[4rem] leading-[0.86] font-light tracking-[-0.05em] text-[var(--color-text)]">
              hy<span className="italic text-[var(--color-accent)]">P</span>er
            </h1>
            <p className="t-display-italic text-[var(--color-text-dim)] text-lg mt-5 max-w-[20ch]">
              Strength &amp; nourishment, kept like a journal.
            </p>
          </div>
        </header>

        {/* ─── Form ─── */}
        <div className="mt-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={isLogin ? 'login' : 'signup'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={springs.smooth}
              className="mb-7"
            >
              <p className="t-label-sm mb-2">{isLogin ? 'Sign in' : 'Create account'}</p>
              <h2 className="t-title">{isLogin ? 'Welcome back' : 'Get started'}</h2>
            </motion.div>
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-7">
            <AnimatePresence>
              {!isLogin && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springs.smooth}
                  className="overflow-hidden"
                >
                  <Input
                    label="Name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />

            <AnimatePresence>
              {!isLogin && signupSuccess && (
                <motion.div
                  className="border-l-2 border-[var(--color-text)] pl-4 py-1"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={springs.smooth}
                >
                  <p className="t-caption text-[var(--color-text)]">{signupSuccess}</p>
                  <p className="mt-2 t-caption">Verification emails can land in spam, junk, or promotions.</p>
                  {(pendingVerificationEmail || email) && (
                    <button
                      type="button"
                      onClick={() => { void handleResendVerification(); }}
                      disabled={resendingVerification}
                      className="mt-3 text-[10px] tracking-[0.2em] uppercase font-medium text-[var(--color-text)] border-b border-[var(--color-accent)] disabled:opacity-50"
                    >
                      {resendingVerification ? 'Resending…' : 'Resend verification email'}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.p
                  className="border-l-2 border-[var(--color-accent)] pl-4 py-1 t-caption text-[var(--color-accent)]"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={springs.smooth}
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {!isLogin && showSignInPrompt && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={springs.smooth}
                >
                  <button
                    type="button"
                    onClick={switchToLogin}
                    className="text-[10px] tracking-[0.2em] uppercase font-medium text-[var(--color-text)] border-b border-[var(--color-accent)]"
                  >
                    Go to sign in
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={loading && !(signupButtonLocked && !isLogin)}
              disabled={!isLogin && signupButtonLocked}
            >
              {isLogin ? 'Sign in' : signupButtonLocked ? 'Check your email' : 'Create account'}
            </Button>
          </form>

          {/* ─── Divider ─── */}
          <div className="relative my-7">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <div className="w-full border-t border-[var(--color-border)]" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-4 bg-[var(--color-base)] t-label-sm">or</span>
            </div>
          </div>

          <Button type="button" variant="secondary" size="lg" className="w-full" onClick={handleGoogleSignIn}>
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </Button>

          <p className="mt-9 text-center text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)]">
            {isLogin ? 'No account?' : 'Have an account?'}{' '}
            <button
              type="button"
              onClick={() => {
                const nextIsLogin = !isLogin;
                clearSignupSignals();
                setIsLogin(nextIsLogin);
                setError(null);
                if (!nextIsLogin) {
                  setSignupSuccess(null);
                  setShowSignInPrompt(false);
                }
              }}
              className="text-[var(--color-text)] border-b border-[var(--color-accent)] ml-1"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </motion.div>

      <LoginMonolithIntro active={showIntro} onComplete={finishIntro} />
    </div>
  );
}
