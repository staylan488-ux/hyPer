import { useState } from 'react';
import { motion } from 'motion/react';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/shared/Button';
import { BrandWordmark } from '@/components/intro/BrandWordmark';
import { springs } from '@/lib/animations';
import { PRIVATE_BETA_MESSAGE, PRIVATE_BETA_TITLE } from '@/lib/betaAccess';

/** Shown to a signed-in account that is not on the private beta list. */
export function PrivateBetaScreen() {
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const checkBetaAccess = useAuthStore((state) => state.checkBetaAccess);
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    try {
      await checkBetaAccess();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="material-foundation min-h-screen flex flex-col justify-center px-7 py-14">
      <motion.div
        className="w-full max-w-[26rem] mx-auto"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.settle}
      >
        <header>
          <span className="t-label-sm">Private beta</span>
          <div className="border-t border-[var(--color-text)] mt-3 pt-6">
            <h1><BrandWordmark variant="login" /></h1>
          </div>
        </header>

        <div className="mt-12" role="status">
          <h2 className="t-title">{PRIVATE_BETA_TITLE}</h2>
          <p className="t-caption text-[var(--color-text)] mt-4">{PRIVATE_BETA_MESSAGE}</p>
          {user?.email && (
            <p className="t-caption mt-3">Signed in as {user.email}</p>
          )}
        </div>

        <div className="mt-10 space-y-3">
          <Button type="button" className="w-full" loading={checking} onClick={() => { void checkAgain(); }}>
            Check again
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => { void signOut(); }}>
            Sign out
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
