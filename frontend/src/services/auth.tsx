import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (email: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadUser(): AuthUser | null {
  const raw = localStorage.getItem('icr_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem('icr_user');
    localStorage.removeItem('icr_token');
    return null;
  }
}

// ponytail: dev-only stub auth (email -> local token), swap for Firebase Auth /
// Identity Platform before deployment; backend must keep deriving identity from
// the verified token, never from client-supplied user ids.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadUser());

  const login = (email: string) => {
    const id = `dev_${btoa(email).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
    const nextUser = { id, email };
    localStorage.setItem('icr_user', JSON.stringify(nextUser));
    localStorage.setItem('icr_token', id);
    setUser(nextUser);
  };

  const logout = () => {
    localStorage.removeItem('icr_user');
    localStorage.removeItem('icr_token');
    setUser(null);
  };

  const value = useMemo(() => ({ user, login, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
