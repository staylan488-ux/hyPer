import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input } from '@/components/shared';
import { BrandWordmark } from '@/components/intro/BrandWordmark';
import { springs } from '@/lib/animations';
import { isNativeIOS } from '@/lib/nativeBridge';
import './auth.css';

const SIGNUP_SUCCESS_MESSAGE = 'Account created. Check your email to verify before signing in.';

export function AuthForm() {
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

  const { signIn, signUp, resendSignupConfirmation, signInWithGoogle, signInWithApple, loading } = useAuthStore();
  const showAppleSignIn = isNativeIOS();

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

  const handleAppleSignIn = async () => {
    clearSignupSignals();
    setError(null);
    const { error } = await signInWithApple();
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

  return (
    <div className="you-auth">
      <div className="you-auth-inner">
        {/* ─── Masthead ─── */}
        <header>
          <div className="you-auth-mast">
            <span className="metal-eyebrow">A field journal</span>
            <span className="metal-eyebrow">Est. MMXXVI</span>
          </div>
          <h1 className="you-auth-word"><BrandWordmark variant="login" /></h1>
          <p className="metal-quote you-auth-tagline">
            Strength &amp; nourishment, kept like a journal.
          </p>
        </header>

        {/* ─── Form ─── */}
        <div className="metal-section mt-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={isLogin ? 'login' : 'signup'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={springs.settle}
              className="mt-4 mb-7"
            >
              <p className="metal-eyebrow">{isLogin ? 'Sign in' : 'Create account'}</p>
              <h2 className="metal-title">{isLogin ? 'Welcome back' : 'Get started'}</h2>
            </motion.div>
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-6">
            <AnimatePresence>
              {!isLogin && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springs.settle}
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
                  className="py-2"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={springs.settle}
                >
                  <p className="text-[14px] leading-snug text-[var(--metal-ink)]">{signupSuccess}</p>
                  <p className="mt-2 text-[13px] leading-snug text-[var(--metal-ink-2)]">Verification emails can land in spam, junk, or promotions.</p>
                  {(pendingVerificationEmail || email) && (
                    <button
                      type="button"
                      onClick={() => { void handleResendVerification(); }}
                      disabled={resendingVerification}
                      className="you-auth-link mt-1"
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
                  className="metal-flag py-1 text-[var(--metal-ink)]"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={springs.settle}
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
                  transition={springs.settle}
                >
                  <button
                    type="button"
                    onClick={switchToLogin}
                    className="you-auth-link"
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
          <div className="you-auth-or">or</div>

          <Button type="button" variant="secondary" size="lg" className="w-full" onClick={handleGoogleSignIn}>
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </Button>

          {showAppleSignIn && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full mt-3"
              onClick={handleAppleSignIn}
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M16.7 13.1c0-2.8 2.3-4.1 2.4-4.2-1.3-1.9-3.4-2.2-4.1-2.2-1.7-.2-3.4 1-4.3 1-.9 0-2.3-1-3.7-1-1.9 0-3.6 1.1-4.6 2.8-2 3.4-.5 8.4 1.4 11.2.9 1.4 2.1 2.9 3.6 2.8 1.4-.1 2-.9 3.7-.9s2.2.9 3.7.9c1.5 0 2.5-1.4 3.5-2.8 1.1-1.6 1.5-3.1 1.5-3.2-.1 0-3.1-1.2-3.1-4.4ZM13.9 4.9c.8-1 1.4-2.4 1.2-3.8-1.2.1-2.7.8-3.6 1.8-.8.9-1.5 2.3-1.3 3.7 1.4.1 2.8-.7 3.7-1.7Z"
                />
              </svg>
              Continue with Apple
            </Button>
          )}

          <p className="you-auth-foot">
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
              className="you-auth-link ml-1"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
