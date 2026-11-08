import { create } from 'zustand';

/**
 * A link from an email (password reset, sign-up confirmation) whose code
 * could not sign in: expired, used already, or opened on another phone.
 * Sign-in shows it until the next try.
 */
export const useAuthLinkError = create<{ message: string | null; set: (message: string) => void; clear: () => void }>((set) => ({
  message: null,
  set: (message) => set({ message }),
  clear: () => set({ message: null }),
}));

/** What sign-in says for a link that didn't work. */
export const AUTH_LINK_FAILED = 'That link has expired or was already used. Request a new one, and open it on this iPhone.';
