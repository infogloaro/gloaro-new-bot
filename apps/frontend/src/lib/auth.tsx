import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, tokens } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On a page refresh the token is still in storage - confirm it is valid
  // before rendering the app, so a revoked account cannot see a stale shell.
  useEffect(() => {
    if (!tokens.access()) {
      setLoading(false);
      return;
    }
    api
      .get<User>('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    tokens.set(res.data.accessToken, res.data.refreshToken);
    setUser(res.data.user);
  }, []);

  const logout = useCallback(() => {
    tokens.clear();
    setUser(null);
    window.location.href = '/login';
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
