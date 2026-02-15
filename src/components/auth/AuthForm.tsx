import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Card } from '@/components/shared';
import { springs } from '@/lib/animations';

export function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { signIn, signUp, signInWithGoogle, loading } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isLogin) {
      const { error } = await signIn(email, password);
      if (error) setError(error.message);
    } else {
      const { error } = await signUp(email, password, displayName);
      if (error) setError(error.message);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) setError(error.message);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-[#1A1A1A] relative">
      {/* Warm gradient overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(circle at 50% 0%, rgba(196, 164, 132, 0.03), transparent 60%)'
      }} />
      <motion.div
        className="w-full max-w-sm relative z-10"
      >
        {/* Brand Header */}
        <motion.div className="text-center mb-12" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <motion.p
            className="text-[10px] tracking-[0.3em] text-[#6B6B6B] mb-3"
            initial={{ opacity: 0, letterSpacing: '0.5em' }}
            animate={{ opacity: 1, letterSpacing: '0.3em' }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            hyPer
          </motion.p>
          <AnimatePresence mode="wait">
            <motion.h1
              key={isLogin ? 'login' : 'signup'}
              className="text-3xl font-display-italic text-[#E8E4DE] tracking-tight"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={springs.smooth}
            >
              {isLogin ? 'Welcome Back' : 'Get Started'}
            </motion.h1>
          </AnimatePresence>
          <p className="text-xs text-[#6B6B6B] mt-2">
            Science-based training & nutrition
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <Card variant="slab" className="mb-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <AnimatePresence>
                {!isLogin && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={springs.smooth}
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
                required
              />

              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />

              <AnimatePresence>
                {error && (
                  <motion.p
                    className="text-[10px] tracking-wide text-[#8B6B6B] text-center py-2"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: [0, -4, 4, -3, 3, 0] }}
                    exit={{ opacity: 0 }}
                    transition={{ x: { duration: 0.4, ease: 'easeOut' }, opacity: springs.smooth }}
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <Button
                type="submit"
                className="w-full"
                loading={loading}
              >
                {isLogin ? 'Sign In' : 'Create Account'}
              </Button>
            </form>
          </Card>
        </motion.div>

        <motion.div className="relative mb-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/5" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-4 bg-[#1A1A1A] text-[9px] tracking-[0.15em] uppercase text-[#6B6B6B]">or</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={handleGoogleSignIn}
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </Button>
        </motion.div>

        <motion.p
          className="mt-8 text-center text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          {isLogin ? "No account?" : 'Have an account?'}{' '}
          <motion.button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
            }}
            className="text-[#E8E4DE] hover:text-white"
            whileTap={{ scale: 0.95 }}
          >
            {isLogin ? 'Sign Up' : 'Sign In'}
          </motion.button>
        </motion.p>
      </motion.div>
    </div>
  );
}
