import { Response } from 'express';

export function success(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data, error: null });
}

/**
 * `data` is for the rare failure a client has to BRANCH on rather than just
 * display — a blocked account, which has to end the session and show the
 * reason. Defaults to null, so every existing call is unchanged.
 */
export function error(res: Response, message: string, status = 400, data: unknown = null) {
  return res.status(status).json({ success: false, data, error: message });
}
