import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../services/api';
import { errorMessage, isUnauthorized } from '../config/errors';
import { useShoppingListStore } from '../store/shoppingListStore';
import { useNotificationStore } from '../store/notificationStore';
import type { User } from '../models';

export interface AuthContextValue {
  user: User | null;
  /** True until the stored token (if any) has been checked against the API. */
  loading: boolean;
  /** Rejects with an Error carrying a user-readable message. */
  signIn: (email: string, password: string) => Promise<void>;
  /** Rejects with an Error carrying a user-readable message. */
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Drops everything that belongs to the previous user. */
function forgetSession(): void {
  setToken(null);
  useShoppingListStore.getState().reset();
  useNotificationStore.getState().reset();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null);

  // Restore the session from the stored token.
  useEffect(() => {
    if (getToken() === null) return;

    let cancelled = false;
    api.auth
      .me()
      .then(({ user: me }) => {
        if (!cancelled) setUser(me);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // An expired or revoked token is dropped. Any other failure (API down) leaves the
        // token alone so the session comes back when the server does.
        if (isUnauthorized(error)) forgetSession();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { token, user: signedIn } = await api.auth.login(email.trim(), password);
      useShoppingListStore.getState().reset();
      setToken(token);
      setUser(signedIn);
    } catch (error) {
      throw new Error(errorMessage(error, 'Could not sign in. Please try again.'));
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    try {
      const name = displayName?.trim();
      const { token, user: created } = await api.auth.register(
        email.trim(),
        password,
        name ? name : undefined
      );
      useShoppingListStore.getState().reset();
      setToken(token);
      setUser(created);
    } catch (error) {
      throw new Error(errorMessage(error, 'Could not create the account. Please try again.'));
    }
  }, []);

  const signOut = useCallback(() => {
    forgetSession();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
