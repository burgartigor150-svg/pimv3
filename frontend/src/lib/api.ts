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
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);


// Wildberries API configuration
export const wildberriesApi = axios.create({
  baseURL: 'https://suppliers-api.wildberries.ru',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('wildberries_token') || ''}`
  },
});

wildberriesApi.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('Wildberries API error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Wildberries API endpoints
export const wildberriesEndpoints = {
  products: '/public/api/v1/info',
  orders: '/api/v2/orders',
  stocks: '/api/v2/stocks',
  prices: '/public/api/v1/prices'
};
