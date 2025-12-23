import { Request, Response, NextFunction } from 'express';
import { verifyIdToken, AuthUser } from './firebaseAuth';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Express middleware to enforce Firebase Auth.
 * Expects header: Authorization: Bearer <idToken>
 */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.replace('Bearer ', '').trim();
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = await verifyIdToken(idToken);
    req.user = { uid: decoded.uid, email: decoded.email };
    return next();
  } catch (error) {
    console.error('[requireAuth] verify error:', error);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

