import { timingSafeEqual } from 'node:crypto';
import { sendError } from './http.js';

const getHeaderValue = (req, name) =>
  req.headers?.[name] ||
  req.headers?.[name.toLowerCase()] ||
  req.headers?.[name.toUpperCase()] ||
  '';

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export const getFamilyCodeFromRequest = (req) =>
  String(getHeaderValue(req, 'x-family-code') || '').trim();

export const requireFamilyCode = (req, res) => {
  const configuredCode = String(process.env.FAMILY_ACCESS_CODE || '').trim();
  if (!configuredCode) {
    sendError(req, res, 500, 'SERVER_NOT_CONFIGURED', 'Family access code is not configured');
    return false;
  }

  const requestCode = getFamilyCodeFromRequest(req);
  if (!requestCode || !safeEqual(requestCode, configuredCode)) {
    sendError(req, res, 401, 'INVALID_FAMILY_CODE', 'A valid family code is required');
    return false;
  }

  return true;
};
