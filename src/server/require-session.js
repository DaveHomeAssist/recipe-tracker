import { unauthorized } from './http.js';
import { getSessionFromRequest } from './session.js';

export const requireSession = (req, res) => {
  const session = getSessionFromRequest(req, process.env.SESSION_SECRET);
  if (session.authenticated) return session;
  unauthorized(req, res);
  return null;
};
