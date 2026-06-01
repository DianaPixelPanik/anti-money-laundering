"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "aml_token";

interface AuthState {
  token: string | null;
  tenantId: string;
  loading: boolean;
  error: string | null;
}

interface AuthContext extends AuthState {
  authHeaders: () => Record<string, string>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthContext>({
  token: null,
  tenantId: "default",
  loading: true,
  error: null,
  authHeaders: () => ({}),
  signOut: () => {},
  refresh: async () => {},
});

async function acquireDevToken(tenantId: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Auth endpoint returned ${res.status}`);
  }
  const { token } = await res.json();
  return token as string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    tenantId: "default",
    loading: true,
    error: null,
  });

  const acquire = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const token = await acquireDevToken("default");
      localStorage.setItem(TOKEN_KEY, token);
      setState({ token, tenantId: "default", loading: false, error: null });
    } catch (err) {
      setState({
        token: null,
        tenantId: "default",
        loading: false,
        error: err instanceof Error ? err.message : "Authentication failed",
      });
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setState({ token: stored, tenantId: "default", loading: false, error: null });
    } else {
      acquire();
    }
  }, [acquire]);

  const authHeaders = useCallback((): Record<string, string> => {
    if (!state.token) return {};
    return { Authorization: `Bearer ${state.token}` };
  }, [state.token]);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setState({ token: null, tenantId: "default", loading: false, error: null });
  }, []);

  // Called by components when they receive a 401 — clears stale token and re-acquires
  const refresh = useCallback(async () => {
    localStorage.removeItem(TOKEN_KEY);
    await acquire();
  }, [acquire]);

  return (
    <Ctx.Provider value={{ ...state, authHeaders, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
