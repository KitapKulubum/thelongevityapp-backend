import { Request, Response, NextFunction } from 'express';
import { verifyIdToken, AuthUser } from './firebaseAuth';
import { hasActiveSubscription } from '../subscription/appleSubscription';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Express middleware to enforce Firebase Auth.
 * Expects header: Authorization: Bearer <idToken>
 * 
 * NOTE: Email verification is NOT required for general API access.
 * Users can use the app immediately after signup.
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

/**
 * Express middleware to enforce email verification for sensitive actions.
 * 
 * Sensitive actions that require email verification:
 * - Password reset (already handled via OTP)
 * - Email change
 * - Subscription / billing
 * - Account deletion
 * 
 * This middleware should be used ONLY for these sensitive endpoints.
 */
export async function requireEmailVerification(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // First ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get fresh token to check email verification status
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.replace('Bearer ', '').trim();
    const decoded = await verifyIdToken(idToken);

    // Check if email is verified
    if (!decoded.email_verified) {
      return res.status(403).json({
        error: 'email_verification_required',
        message: 'Email verification is required for this action. Please verify your email address.',
      });
    }

    return next();
  } catch (error) {
    console.error('[requireEmailVerification] error:', error);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/**
 * Express middleware to enforce active subscription for app features.
 * 
 * This middleware should be applied to all core app endpoints that require
 * a subscription. Users can authenticate, but need an active subscription
 * to access premium features.
 * 
 * Returns 403 with subscription_required error if subscription is not active.
 */
export async function requireSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // First ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.uid;

    // Check if user has active subscription
    const hasActive = await hasActiveSubscription(userId);

    if (!hasActive) {
      return res.status(403).json({
        error: 'subscription_required',
        message: 'An active subscription is required to access this feature.',
        code: 'SUBSCRIPTION_REQUIRED',
      });
    }

    return next();
  } catch (error) {
    console.error('[requireSubscription] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

