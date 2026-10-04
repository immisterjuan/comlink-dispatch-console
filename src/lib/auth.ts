const AUTH_KEY = 'comlink-authed';

export const isAuthenticated = (): boolean => {
  try {
    return localStorage.getItem(AUTH_KEY) === '1';
  } catch {
    return false;
  }
};

export const setAuthenticated = (): void => {
  try {
    localStorage.setItem(AUTH_KEY, '1');
  } catch {
    // localStorage unavailable — session-only access
  }
};

export const logout = (): void => {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // localStorage unavailable
  }
};
