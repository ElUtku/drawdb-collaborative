import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authApi } from "../api/auth";
import { UNAUTHORIZED_EVENT } from "../api/request";

export const AUTH_STATUS = Object.freeze({
  LOADING: "loading",
  AUTHENTICATED: "authenticated",
  ANONYMOUS: "anonymous",
});

export const AuthContext = createContext(null);

export default function AuthContextProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(AUTH_STATUS.LOADING);

  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((current) => {
        if (!active) return;
        setUser(current);
        setStatus(AUTH_STATUS.AUTHENTICATED);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setStatus(AUTH_STATUS.ANONYMOUS);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setStatus(AUTH_STATUS.ANONYMOUS);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const adopt = useCallback((current) => {
    setUser(current);
    setStatus(AUTH_STATUS.AUTHENTICATED);
    return current;
  }, []);

  const login = useCallback(
    async (credentials) => adopt(await authApi.login(credentials)),
    [adopt],
  );

  const register = useCallback(
    async (credentials) => adopt(await authApi.register(credentials)),
    [adopt],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus(AUTH_STATUS.ANONYMOUS);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === AUTH_STATUS.AUTHENTICATED,
      isAdmin: Boolean(user?.isAdmin),
      login,
      register,
      logout,
    }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
