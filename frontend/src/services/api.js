// Instancia Axios + llamadas al backend. Inyecta el JWT de Supabase en cada request.
import axios from 'axios';
import { supabase } from '../lib/supabase';
import { isDemo } from '../demo/mode.js';
import demoAdapter from '../demo/adapter.js';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

// Adjuntar token de Supabase a cada request
api.interceptors.request.use(async (config) => {
  // En modo demo cortamos antes de la red: un adapter propio responde con datos
  // sintéticos, y ni Supabase ni el backend se enteran de la request.
  if (isDemo()) {
    config.adapter = demoAdapter;
    return config;
  }
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

// --- Custodios ---
export const getCustodians   = ()     => api.get('/custodians').then((r) => r.data);
export const createCustodian = (body) => api.post('/custodians', body).then((r) => r.data);

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

// --- Admin ---
// Usa la misma instancia que el resto: JWT de Supabase. El backend exige además
// rol 'admin' en public.users. Antes había una instancia aparte con un token
// hardcodeado que estaba en el repo público.
export const getAdminUsers   = ()     => api.get('/admin/users').then(r => r.data);
export const getAdminStats   = ()     => api.get('/admin/stats').then(r => r.data);
export const deleteAdminUser = (id)   => api.delete(`/admin/users/${id}`);

// --- Solicitud de invitación (público, sin sesión) ---
export const requestInvitation = (body) => api.post('/invite-requests', body).then(r => r.data);

// --- Solicitudes en el panel admin ---
export const getInviteRequests     = ()   => api.get('/admin/invite-requests').then(r => r.data);
export const approveInviteRequest  = (id) => api.post(`/admin/invite-requests/${id}/approve`).then(r => r.data);
export const rejectInviteRequest   = (id) => api.post(`/admin/invite-requests/${id}/reject`).then(r => r.data);

// --- Invitaciones de registro ---
export const getInvitations   = ()      => api.get('/admin/invitations').then(r => r.data);
export const createInvitation = (body)  => api.post('/admin/invitations', body).then(r => r.data);
export const deleteInvitation = (id)    => api.delete(`/admin/invitations/${id}`);

// --- Cartolas ---
export const uploadStatement  = (formData) => api.post('/statements', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
}).then((r) => r.data);
export const getStatements    = ()          => api.get('/statements').then((r) => r.data);
export const getStatement     = (id)        => api.get(`/statements/${id}`).then((r) => r.data);
export const updateStatement  = (id, body)  => api.put(`/statements/${id}`, body).then((r) => r.data);
export const confirmStatement = (id, body)  => api.post(`/statements/${id}/confirm`, body).then((r) => r.data);
export const deleteStatement  = (id)        => api.delete(`/statements/${id}`);

// --- Admin: maestro de activos ---
export const getPendingInstruments = ()        => api.get('/admin/instruments/pending').then((r) => r.data);
export const mapInstrument   = (id, body)      => api.put(`/admin/instruments/${id}/map`, body).then((r) => r.data);
export const mergeInstrument = (id, targetId)  => api.post(`/admin/instruments/${id}/merge`, { target_id: targetId }).then((r) => r.data);
export const searchInstruments = (q)           => api.get('/admin/instruments/search', { params: { q } }).then((r) => r.data);

// --- IA ---
export const parseCartola   = (formData) => api.post('/ai/parse-cartola', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
}).then((r) => r.data);
export const sendChatMessage = (messages) => api.post('/ai/chat', { messages }).then((r) => r.data);

export default api;
