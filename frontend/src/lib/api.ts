import axios from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const url: string = error.config?.url || '';
      console.warn('[API 401] url:', url);
      // Only force logout if the auth/me endpoint fails (token truly invalid)
      // Other 401s (missing permissions on specific endpoints) should not logout
      if (url.includes('/auth/me')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

