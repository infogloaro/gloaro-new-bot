import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

const ACCESS_KEY = 'gloaro.accessToken';
const REFRESH_KEY = 'gloaro.refreshToken';

export const tokens = {
  access: () => localStorage.getItem(ACCESS_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api = axios.create({ baseURL: '/api', timeout: 20_000 });

api.interceptors.request.use((config) => {
  const token = tokens.access();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Access tokens live 15 minutes. On the first 401 the client silently exchanges
 * the refresh token and replays the request; a second failure logs the user out.
 * Concurrent 401s share one refresh call rather than starting a stampede.
 */
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };

    const isAuthCall = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');

    if (error.response?.status !== 401 || original?._retried || isAuthCall) {
      return Promise.reject(error);
    }

    const refreshToken = tokens.refresh();
    if (!refreshToken) {
      tokens.clear();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      refreshing ??= axios
        .post('/api/auth/refresh', { refreshToken })
        .then((res) => {
          tokens.set(res.data.accessToken, res.data.refreshToken);
          return res.data.accessToken as string;
        })
        .finally(() => {
          refreshing = null;
        });

      const newToken = await refreshing;
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch (refreshError) {
      tokens.clear();
      window.location.href = '/login';
      return Promise.reject(refreshError);
    }
  },
);

/** Pulls a readable message out of a Nest validation or exception response. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join(', ');
    if (data?.message) return data.message;
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}
