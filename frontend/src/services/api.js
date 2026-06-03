// Instancia Axios + llamadas al backend. Inyecta el JWT de Supabase en cada request.
import axios from 'axios';
import { supabase } from '../lib/supabase';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

// Adjuntar token de Supabase a cada request
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// --- Instrumentos ---
export const getInstruments = () => api.get('/instruments').then((r) => r.data);
export const createInstrument = (body) => api.post('/instruments', body).then((r) => r.data);
export const updateInstrument = (id, body) => api.put(`/instruments/${id}`, body).then((r) => r.data);
export const deleteInstrument = (id) => api.delete(`/instruments/${id}`);

// --- Posiciones ---
export const getPositions = () => api.get('/positions').then((r) => r.data);
export const createPosition = (body) => api.post('/positions', body).then((r) => r.data);
export const updatePosition = (id, body) => api.put(`/positions/${id}`, body).then((r) => r.data);
export const deletePosition = (id) => api.delete(`/positions/${id}`);
export const addAporte = (id, body) => api.post(`/positions/${id}/aporte`, body).then((r) => r.data);

// --- Movimientos ---
export const getMovements = (params) => api.get('/movements', { params }).then((r) => r.data);
export const createMovement = (body) => api.post('/movements', body).then((r) => r.data);
export const updateMovement = (id, body) => api.put(`/movements/${id}`, body).then((r) => r.data);
export const deleteMovement = (id) => api.delete(`/movements/${id}`);

// --- Precios ---
export const getLatestPrices = () => api.get('/prices/latest').then((r) => r.data);
export const getPriceHistory = (instrumentId, params) =>
  api.get(`/prices/${instrumentId}`, { params }).then((r) => r.data);
export const setManualPrice = (body) => api.post('/prices/manual', body).then((r) => r.data);
export const refreshPrices = () => api.post('/prices/refresh').then((r) => r.data);

// --- Portafolio ---
export const getSummary = () => api.get('/portfolio/summary').then((r) => r.data);
export const getSnapshots = (params) => api.get('/portfolio/snapshots', { params }).then((r) => r.data);
export const getBreakdown = () => api.get('/portfolio/breakdown').then((r) => r.data);
export const forceSnapshot = (body) => api.post('/portfolio/snapshot', body).then((r) => r.data);
export const getRentabilidad = (params) => api.get('/portfolio/rentabilidad', { params }).then((r) => r.data);
export const getMonthlyRentabilidad = (params) =>
  api.get('/portfolio/rentabilidad/monthly', { params }).then((r) => r.data);
export const getTWR = (params) =>
  api.get('/portfolio/twr', { params }).then((r) => r.data);

// --- Mercado ---
export const getMarket = () => api.get('/market').then((r) => r.data);

export default api;
