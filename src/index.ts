import express, { Express } from 'express';
import cors from 'cors';
import { DateTime } from 'luxon';
import { ingestKnowledgeDir, ingestUserLog } from './rag/ingest';
import { longevityChat } from './rag/chat';
import { generateAgeMessage } from './age/ageMessages';
import {
  setOnboardingScore,
  getScoreState,
  updateScoreFromDaily,
} from './score/scoreStore';
import { OnboardingAnswers as ScoreOnboardingAnswers } from './score/scoreModel';
import {
  calculateOnboardingResult,
  calculateDailyScore,
  MAX_OFFSET_YEARS,
  AGE_FACTOR,
} from './longevity/longevityScoring';
import {
  upsertUserOnboarding,
  getUserDocument,
  saveDailyEntry,
  getDailyEntry,
  listDailyEntries,
  updateUserAfterDaily,
  hasCompletedOnboarding,
  getTodayDateKey,
  hasDailyEntryForDateKey,
  getChatHistory,
  saveChatMessage,
  getDailyEntriesForTrends,
} from './longevity/longevityStore';
import { calculateStreak, daysBetween } from './longevity/streakHelpers';
import {
  OnboardingSubmitRequest,
  OnboardingSubmitResponse,
  DailyEntryDocument,
  DeltaAnalyticsResponse,
  WeeklyDeltaResponse,
  MonthlyDeltaResponse,
  YearlyDeltaResponse,
  DeltaSummary,
  DeltaSeriesPoint,
  MonthlyDeltaSeriesPoint,
  BiologicalAgeState,
  DailyMetrics,
  DailyUpdateResponse,
  HistoryPoint,
  TodayEntry,
  StatsSummaryResponse,
  TrendResponse,
  TrendPeriod,
  TrendPoint,
  MetricScores,
  MetricsScoresResponse,
} from './longevity/longevityModel';
import { requireAuth, requireEmailVerification, requireSubscription, AuthenticatedRequest } from './auth/authMiddleware';
import { verifyIdToken, getOrCreateUserProfile, calculateAgeFromDateOfBirth } from './auth/firebaseAuth';
import { firestore } from './config/firestore';
import * as admin from 'firebase-admin';
import {
  requestPasswordReset,
  verifyPasswordResetOTP,
  confirmPasswordReset,
} from './auth/passwordReset';
import { sendVerificationEmail } from './auth/emailService';
import { validatePassword } from './auth/passwordValidation';
import { getPrivacyPolicy, getTermsOfService } from './legal/documents';
import { recordConsent, getConsentRecord, needsConsentUpdate } from './legal/consentTracking';
import {
  verifyAndUpdateSubscription,
  getSubscriptionStatus,
  hasActiveSubscription,
  handleAppleNotification,
} from './subscription/appleSubscription';

const clampValue = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const app: Express = express();

app.use(cors());
app.use(express.json());

function normalizeDailyMetrics(body: any): DailyMetrics {
  const today = new Date().toISOString().slice(0, 10);
  const source = body.metrics ?? body;

  const num = (value: any, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const bool = (value: any) => Boolean(value);

  return {
    date: source.date ?? today,
    sleepHours: num(source.sleepHours),
    steps: num(source.steps),
    vigorousMinutes: num(source.vigorousMinutes),
    processedFoodScore: num(source.processedFoodScore),
    alcoholUnits: num(source.alcoholUnits),
    stressLevel: num(source.stressLevel),
    lateCaffeine: bool(source.lateCaffeine),
    screenLate: bool(source.screenLate),
    bedtimeHour: num(source.bedtimeHour),
  };
}

app.post('/api/chat', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const { message } = req.body;
    const userId = req.user!.uid; // Get userId from auth token
    
    console.log('[chat] Request received:', { userId, messageLength: message?.length });
    
    if (!message) {
      console.error('[chat] Missing required field: message');
      return res.status(400).json({ error: 'message is required' });
    }

    if (typeof message !== 'string' || message.trim().length === 0) {
      console.error('[chat] Invalid message:', message);
      return res.status(400).json({ error: 'message must be a non-empty string' });
    }

    console.log('[chat] Calling longevityChat...');
    const result = await longevityChat({ userId, message: message.trim() });
    console.log('[chat] Success, answer length:', result.answer?.length);
    
    return res.json(result);
  } catch (error: any) {
    console.error('[chat] Error:', error);
    console.error('[chat] Error stack:', error?.stack);
    console.error('[chat] Error message:', error?.message);
    
    // Return more detailed error in development
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error?.message || 'Internal server error'
      : 'Internal server error';
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: error?.stack })
    });
  }
});

app.post('/api/ingest-log', async (req, res) => {
  try {
    const { userId, logText } = req.body;
    if (!userId || !logText) {
      return res.status(400).json({ error: 'userId and logText are required' });
    }
    await ingestUserLog(userId, logText);
    return res.json({ ok: true });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/me
 * Verifies idToken and returns/creates Firestore user profile.
 * Accepts optional firstName, lastName, dateOfBirth for sign-up flow.
 */
app.post('/api/auth/me', async (req, res) => {
  try {
    const { idToken, firstName, lastName, dateOfBirth } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'idToken is required' });
    }

    const decoded = await verifyIdToken(idToken);
    
    // Prepare profile data if provided (typically during sign-up)
    const profileData: { firstName?: string; lastName?: string; dateOfBirth?: string } = {};
    if (firstName !== undefined && typeof firstName === 'string') {
      profileData.firstName = firstName.trim() || undefined;
    }
    if (lastName !== undefined && typeof lastName === 'string') {
      profileData.lastName = lastName.trim() || undefined;
    }
    if (dateOfBirth !== undefined && typeof dateOfBirth === 'string') {
      // Validate date format (ISO date string YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(dateOfBirth)) {
        profileData.dateOfBirth = dateOfBirth;
      } else {
        return res.status(400).json({ error: 'dateOfBirth must be in ISO format (YYYY-MM-DD)' });
      }
    }

    const profile = await getOrCreateUserProfile(decoded.uid, decoded.email, 
      Object.keys(profileData).length > 0 ? profileData : undefined
    );

    // Check if this is a new user (profile was just created)
    const existingConsent = await getConsentRecord(decoded.uid);
    const isNewUser = !existingConsent;
    
    // Record consent if this is a new user and versions are provided
    if (isNewUser) {
      const { acceptedPrivacyPolicyVersion, acceptedTermsVersion } = req.body || {};
      // Only record if versions are explicitly provided (frontend should send these)
      if (acceptedPrivacyPolicyVersion || acceptedTermsVersion) {
        await recordConsent(
          decoded.uid,
          acceptedPrivacyPolicyVersion,
          acceptedTermsVersion
        );
      }
    }

    const completedOnboarding = await hasCompletedOnboarding(decoded.uid);
    const consentNeedsUpdate = await needsConsentUpdate(decoded.uid);
    const subscription = await getSubscriptionStatus(decoded.uid);

    // Map subscription status to display name for Profile screen
    const membershipDisplayName = subscription.status === 'active' ? 'Longevity Premium' : 'Free';

    return res.json({
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified ?? false,
      profile,
      hasCompletedOnboarding: completedOnboarding,
      consentNeedsUpdate,
      subscription: {
        status: subscription.status,
        plan: subscription.plan,
        renewalDate: subscription.renewalDate,
        membershipDisplayName, // "Free" or "Longevity Premium"
      },
    });
  } catch (error: any) {
    console.error('[auth/me] error:', error);
    if (String(error?.message ?? '').toLowerCase().includes('auth')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/auth/profile
 * Protected update of basic profile fields.
 * Supports: firstName, lastName, dateOfBirth, chronologicalAgeYears, timezone
 * If dateOfBirth is updated, chronologicalAgeYears will be recalculated.
 */
app.patch('/api/auth/profile', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const updates: any = {};
    
    // Handle firstName
    if (req.body?.firstName !== undefined) {
      if (typeof req.body.firstName === 'string') {
        updates.firstName = req.body.firstName.trim() || null;
      } else if (req.body.firstName === null) {
        updates.firstName = null;
      } else {
        return res.status(400).json({ error: 'firstName must be a string or null' });
      }
    }
    
    // Handle lastName
    if (req.body?.lastName !== undefined) {
      if (typeof req.body.lastName === 'string') {
        updates.lastName = req.body.lastName.trim() || null;
      } else if (req.body.lastName === null) {
        updates.lastName = null;
      } else {
        return res.status(400).json({ error: 'lastName must be a string or null' });
      }
    }
    
    // Handle dateOfBirth
    if (req.body?.dateOfBirth !== undefined) {
      if (req.body.dateOfBirth === null) {
        updates.dateOfBirth = null;
      } else if (typeof req.body.dateOfBirth === 'string') {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (dateRegex.test(req.body.dateOfBirth)) {
          updates.dateOfBirth = req.body.dateOfBirth;
          // Recalculate chronological age from dateOfBirth
          const calculatedAge = calculateAgeFromDateOfBirth(req.body.dateOfBirth);
          if (calculatedAge !== null) {
            updates.chronologicalAgeYears = calculatedAge;
          }
        } else {
          return res.status(400).json({ error: 'dateOfBirth must be in ISO format (YYYY-MM-DD)' });
        }
      } else {
        return res.status(400).json({ error: 'dateOfBirth must be a string or null' });
      }
    }
    
    // Handle direct chronologicalAgeYears update (deprecated, prefer dateOfBirth)
    if (req.body?.chronologicalAgeYears !== undefined) {
      const val = Number(req.body.chronologicalAgeYears);
      if (Number.isNaN(val)) {
        return res.status(400).json({ error: 'chronologicalAgeYears must be a number' });
      }
      updates.chronologicalAgeYears = val;
    }
    
    // Handle timezone (IANA timezone string, e.g. "Europe/Istanbul", "America/New_York")
    if (req.body?.timezone !== undefined) {
      if (req.body.timezone === null) {
        updates.timezone = null;
      } else if (typeof req.body.timezone === 'string') {
        const trimmed = req.body.timezone.trim();
        if (trimmed.length > 0) {
          updates.timezone = trimmed;
        } else {
          return res.status(400).json({ error: 'timezone must be a valid IANA timezone string or null' });
        }
      } else {
        return res.status(400).json({ error: 'timezone must be a string or null' });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    updates.updatedAt = new Date().toISOString();

    await firestore.collection('users').doc(userId).set(updates, { merge: true });
    const updated = await getOrCreateUserProfile(userId);
    return res.json(updated);
  } catch (error: any) {
    console.error('[auth/profile] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Client-side logout endpoint (logout is primarily handled client-side with Firebase Auth).
 * This endpoint can be called for consistency, but the actual logout happens on the client.
 * Returns success confirmation.
 */
app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    // Logout is handled client-side by Firebase Auth SDK.
    // This endpoint provides a place for any server-side cleanup if needed in the future.
    // For now, it just confirms the request was authenticated.
    return res.json({ success: true, message: 'Logout successful. Please sign out on the client side using Firebase Auth SDK.' });
  } catch (error: any) {
    console.error('[auth/logout] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/auth/email
 * Change user's email address.
 * Requires: email verification (sensitive action)
 * Body: { newEmail: string }
 * Response: 200 { success: true, message: "Email change initiated. Please verify your new email." }
 */
app.patch('/api/auth/email', requireAuth, requireEmailVerification, async (req: AuthenticatedRequest, res) => {
  try {
    const { newEmail } = req.body;
    const userId = req.user!.uid;
    const currentEmail = req.user!.email;

    if (!newEmail || typeof newEmail !== 'string') {
      return res.status(400).json({ error: 'newEmail is required' });
    }

    const normalizedNewEmail = newEmail.trim().toLowerCase();
    if (!normalizedNewEmail.includes('@')) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    if (normalizedNewEmail === currentEmail?.toLowerCase()) {
      return res.status(400).json({ error: 'New email must be different from current email' });
    }

    // Update email in Firebase Auth
    // Note: Firebase will send verification email to the new address
    try {
      await admin.auth().updateUser(userId, {
        email: normalizedNewEmail,
        emailVerified: false, // Reset verification status for new email
      });
    } catch (error: any) {
      if (error.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'email_already_exists', message: 'This email is already in use.' });
      }
      console.error('[auth/email] Failed to update email:', error);
      throw error;
    }

    // Update email in Firestore user profile
    await firestore.collection('users').doc(userId).set(
      { email: normalizedNewEmail, updatedAt: new Date().toISOString() },
      { merge: true }
    );

    return res.json({
      success: true,
      message: 'Email change initiated. Please verify your new email address.',
    });
  } catch (error: any) {
    console.error('[auth/email] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/send-verification-email
 * Send email verification link to user's email address.
 * Requires: authentication
 * Response: 200 { success: true, message: "Verification email sent" }
 */
app.post('/api/auth/send-verification-email', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const userEmail = req.user!.email;

    if (!userEmail) {
      return res.status(400).json({ error: 'User email not found' });
    }

    // Check if email is already verified
    const idToken = req.headers.authorization?.replace('Bearer ', '').trim();
    if (idToken) {
      const decoded = await verifyIdToken(idToken);
      if (decoded.email_verified) {
        return res.status(400).json({ 
          error: 'email_already_verified',
          message: 'Email is already verified.' 
        });
      }
    }

    // Generate email verification link using Firebase Admin SDK
    const actionCodeSettings = {
      url: process.env.EMAIL_VERIFICATION_REDIRECT_URL || 'https://thelongevityapp.ai/email-verified',
      handleCodeInApp: false, // Open link in browser, not app
    };

    const link = await admin.auth().generateEmailVerificationLink(userEmail, actionCodeSettings);

    // Send email using emailService
    await sendVerificationEmail(userEmail, link);

    return res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
    });
  } catch (error: any) {
    console.error('[auth/send-verification-email] error:', error);
    
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/bypassverify
 * Bypass email verification for testing purposes.
 * Sets emailVerified to true for the authenticated user.
 * Requires: authentication
 * Response: 200 { success: true, message: "Email verification bypassed" }
 */
app.post('/api/auth/bypassverify', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const userEmail = req.user!.email;

    if (!userEmail) {
      return res.status(400).json({ error: 'User email not found' });
    }

    // Update user's email verification status to true
    await admin.auth().updateUser(userId, {
      emailVerified: true,
    });

    console.log(`[auth/bypassverify] Email verification bypassed for user ${userId} (${userEmail})`);

    return res.json({
      success: true,
      message: 'Email verification bypassed successfully.',
    });
  } catch (error: any) {
    console.error('[auth/bypassverify] error:', error);
    
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/auth/password
 * Change user's password.
 * Requires: email verification (sensitive action)
 * Body: { currentPassword: string, newPassword: string }
 * Response: 200 { success: true }
 */
app.patch('/api/auth/password', requireAuth, requireEmailVerification, async (req: AuthenticatedRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user!.uid;
    const userEmail = req.user!.email;

    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ error: 'currentPassword is required' });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'newPassword is required' });
    }

    // Validate new password strength
    const validation = validatePassword(newPassword, userEmail);
    if (!validation.ok) {
      return res.status(400).json({
        error: {
          code: validation.code,
          details: validation.details || {},
        },
      });
    }

    // Verify current password by attempting to sign in
    // Note: Firebase Admin SDK doesn't have a direct way to verify password
    // We need to use Firebase Auth REST API or verify via re-authentication
    // For now, we'll update the password directly (client should verify current password first)
    // In production, you might want to add an additional verification step
    
    // Update password in Firebase Auth
    try {
      await admin.auth().updateUser(userId, {
        password: newPassword,
      });
    } catch (error: any) {
      console.error('[auth/password] Failed to update password:', error);
      throw error;
    }

    return res.json({
      success: true,
      message: 'Password updated successfully.',
    });
  } catch (error: any) {
    console.error('[auth/password] error:', error);
    
    // Handle password validation errors
    if (error.validationCode) {
      return res.status(400).json({
        error: {
          code: error.validationCode,
          details: error.validationDetails || {},
        },
      });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/auth/account
 * Delete user account permanently.
 * Requires: email verification (sensitive action)
 * This endpoint deletes:
 * - User from Firebase Auth
 * - User document from Firestore
 * - All daily entries (dailyEntries subcollection)
 * - All chat history (chatHistory subcollection)
 * - All other user-related data
 * Response: 200 { success: true, message: string }
 */
app.delete('/api/auth/account', requireAuth, requireEmailVerification, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;

    // Delete all subcollections first (before deleting user document)
    const userRef = firestore.collection('users').doc(userId);
    
    // Helper function to delete subcollection in batches (Firestore batch limit is 500)
    const deleteSubcollection = async (collectionRef: admin.firestore.CollectionReference, collectionName: string) => {
      const BATCH_SIZE = 500;
      let totalDeleted = 0;
      let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
      
      while (true) {
        let query: admin.firestore.Query = collectionRef.limit(BATCH_SIZE);
        if (lastDoc) {
          query = query.startAfter(lastDoc);
        }
        
        const snapshot = await query.get();
        if (snapshot.empty) break;
        
        const batch = firestore.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        totalDeleted += snapshot.docs.length;
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        
        // If we got fewer than BATCH_SIZE, we're done
        if (snapshot.docs.length < BATCH_SIZE) break;
      }
      
      return totalDeleted;
    };
    
    // Delete dailyEntries subcollection
    try {
      const dailyEntriesRef = userRef.collection('dailyEntries');
      const deletedCount = await deleteSubcollection(dailyEntriesRef, 'dailyEntries');
      if (deletedCount > 0) {
        console.log(`[auth/account] Deleted ${deletedCount} daily entries for user: ${userId}`);
      }
    } catch (error: any) {
      console.error('[auth/account] Failed to delete daily entries:', error);
      // Continue with deletion even if subcollection deletion fails
    }

    // Delete chatHistory subcollection
    try {
      const chatHistoryRef = userRef.collection('chatHistory');
      const deletedCount = await deleteSubcollection(chatHistoryRef, 'chatHistory');
      if (deletedCount > 0) {
        console.log(`[auth/account] Deleted ${deletedCount} chat messages for user: ${userId}`);
      }
    } catch (error: any) {
      console.error('[auth/account] Failed to delete chat history:', error);
      // Continue with deletion even if subcollection deletion fails
    }

    // Delete user document from Firestore
    try {
      await userRef.delete();
      console.log(`[auth/account] Deleted user document for user: ${userId}`);
    } catch (error: any) {
      console.error('[auth/account] Failed to delete user document:', error);
      // Continue even if Firestore delete fails - we'll still try to delete from Auth
    }

    // Delete user from Firebase Auth (this should be last, as it invalidates the token)
    try {
      await admin.auth().deleteUser(userId);
      console.log(`[auth/account] Deleted user from Firebase Auth: ${userId}`);
    } catch (error: any) {
      console.error('[auth/account] Failed to delete user from Firebase Auth:', error);
      // If Auth deletion fails, we've still deleted Firestore data
      // Return success but log the error
      if (error.code === 'auth/user-not-found') {
        // User already deleted from Auth, that's fine
        console.log(`[auth/account] User already deleted from Firebase Auth: ${userId}`);
      } else {
        throw error;
      }
    }

    return res.json({
      success: true,
      message: 'Account deleted successfully. All your data has been permanently removed.',
    });
  } catch (error: any) {
    console.error('[auth/account] error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to delete account. Please try again or contact support.',
    });
  }
});

/**
 * POST /api/auth/password-reset/request
 * Request a password reset OTP code.
 * Body: { email: string }
 * Response: 200 { message: "If an account exists for this email, we've sent a code." }
 */
app.post('/api/auth/password-reset/request', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }

    await requestPasswordReset(email);

    // Always return success to prevent account enumeration
    return res.status(200).json({
      message: "If an account exists for this email, we've sent a code.",
    });
  } catch (error: any) {
    console.error('[password-reset/request] error:', error);

    // Handle rate limiting errors
    if (error.message && error.message.startsWith('too_many_requests')) {
      return res.status(429).json({
        error: 'too_many_requests',
        message: error.message.includes(':') ? error.message.split(':')[1].trim() : 'Too many requests. Please try again later.',
      });
    }

    // For other errors, still return 200 to prevent enumeration
    // But log the error for debugging
    return res.status(200).json({
      message: "If an account exists for this email, we've sent a code.",
    });
  }
});

/**
 * POST /api/auth/password-reset/verify
 * Verify OTP code and get reset token.
 * Body: { email: string, code: string }
 * Response: 200 { resetToken: string } or 400 { error: string }
 */
app.post('/api/auth/password-reset/verify', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code is required' });
    }

    const result = await verifyPasswordResetOTP(email, code);

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('[password-reset/verify] error:', error);

    const errorMessage = error.message || 'invalid_code';

    if (errorMessage === 'expired_code') {
      return res.status(400).json({ error: 'expired_code', message: 'The verification code has expired. Please request a new one.' });
    }

    if (errorMessage === 'too_many_attempts') {
      return res.status(400).json({ error: 'too_many_attempts', message: 'Too many verification attempts. Please request a new code.' });
    }

    if (errorMessage === 'invalid_code') {
      return res.status(400).json({ error: 'invalid_code', message: 'Invalid verification code.' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/password-reset/confirm
 * Confirm password reset with reset token.
 * Body: { resetToken: string, newPassword: string }
 * Response: 200 { success: true }
 */
app.post('/api/auth/password-reset/confirm', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || typeof resetToken !== 'string') {
      return res.status(400).json({ error: 'resetToken is required' });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'newPassword is required' });
    }

    await confirmPasswordReset(resetToken, newPassword);

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('[password-reset/confirm] error:', error);

    // Handle password validation errors
    if (error.validationCode) {
      return res.status(400).json({
        error: {
          code: error.validationCode,
          details: error.validationDetails || {},
        },
      });
    }

    const errorMessage = error.message || 'Internal server error';

    if (errorMessage === 'expired_token') {
      return res.status(400).json({ error: 'expired_token', message: 'The reset token has expired. Please start the process again.' });
    }

    if (errorMessage === 'invalid_token' || errorMessage === 'token_not_verified' || errorMessage === 'token_already_used') {
      return res.status(400).json({ error: 'invalid_token', message: 'Invalid or expired reset token. Please start the process again.' });
    }

    if (errorMessage === 'user_not_found') {
      return res.status(404).json({ error: 'user_not_found', message: 'User account not found.' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/age/daily-update', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  console.log('[daily-update] body:', JSON.stringify(req.body, null, 2));
  try {
    const body = req.body as { metrics?: Partial<DailyMetrics> };
    const userId = req.user!.uid;

    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    // Get user's timezone (default to UTC if not set)
    const userTimezone = user.timezone || 'UTC';
    
    // Calculate today's dateKey in user's timezone
    const todayDateKey = getTodayDateKey(userTimezone);
    
    // Check if a daily entry already exists for today's dateKey
    const entryExists = await hasDailyEntryForDateKey(userId, todayDateKey);
    if (entryExists) {
      return res.status(409).json({
        error: 'Daily check-in already completed',
        message: 'You have already completed your daily check-in for today.',
        dateKey: todayDateKey,
      });
    }

    const chronologicalAgeYears = user.chronologicalAgeYears;

    // Normalize metrics and set date to today's dateKey
    const rawMetrics = normalizeDailyMetrics(body.metrics ?? body);
    const metrics: DailyMetrics = {
      ...rawMetrics,
      date: todayDateKey, // Use dateKey as the date field
    };

    const { score, deltaYears, reasons } = calculateDailyScore(metrics);

    // Build updated state
    const baselineBiologicalAgeYears = user.baselineBiologicalAgeYears;
    const prevBiologicalAge =
      user.currentBiologicalAgeYears ?? user.baselineBiologicalAgeYears ?? chronologicalAgeYears;
    const currentBiologicalAgeYears = prevBiologicalAge + deltaYears;
    const currentAgingDebtYears = currentBiologicalAgeYears - chronologicalAgeYears;

    const threshold = 0.0001;
    
    // Get last check-in day key from user document (source of truth)
    // Fallback to entries if not set (for backward compatibility)
    let lastCheckinDayKey: string | null = user.lastCheckinDayKey || null;

    // Calculate delta vs previous entry (biological age difference)
    const allEntries = await listDailyEntries(userId);
    let actualDeltaYears = deltaYears; // Default to calculated delta from daily score
    
    if (allEntries.length > 0) {
      // Get the most recent entry (last one in sorted array)
      const previousEntry = allEntries[allEntries.length - 1];
      // Use user.lastCheckinDayKey if available, otherwise fall back to entry dateKey
      if (!lastCheckinDayKey) {
        lastCheckinDayKey = previousEntry.dateKey || previousEntry.date || null;
      }
      const previousBioAge = previousEntry.currentBiologicalAgeYears ?? baselineBiologicalAgeYears;
      // Calculate actual delta: today's bio age - previous bio age
      actualDeltaYears = Math.round((currentBiologicalAgeYears - previousBioAge) * 100) / 100;
      console.log('[daily-update] Calculated delta vs previous entry:', {
        previousBioAge,
        currentBioAge: currentBiologicalAgeYears,
        actualDeltaYears,
      });
    } else {
      // First entry: calculate delta from baseline to current biological age
      actualDeltaYears = Math.round((currentBiologicalAgeYears - baselineBiologicalAgeYears) * 100) / 100;
      console.log('[daily-update] First entry, delta calculated from baseline:', {
        baselineBioAge: baselineBiologicalAgeYears,
        currentBioAge: currentBiologicalAgeYears,
        actualDeltaYears,
      });
    }

    // Calculate streaks using helper functions (calendar-day based)
    // Get current streak values
    let currentRejuvenationStreak = user.rejuvenationStreakDays ?? 0;
    let totalRejuvenationDays = user.totalRejuvenationDays ?? 0;

    // Calculate new streaks based on consecutive days
    // Use helper function to determine if this is a consecutive day
    let rejuvenationStreakDays: number;

    // Check if same day (should not happen due to duplicate check, but handle safely)
    if (lastCheckinDayKey === todayDateKey) {
      // Same day: keep streak unchanged
      rejuvenationStreakDays = currentRejuvenationStreak;
      console.log('[daily-update] Same day check-in detected, streak unchanged');
      } else {
      // Calculate days difference
      let daysDiff: number;
      if (lastCheckinDayKey) {
        try {
          daysDiff = daysBetween(lastCheckinDayKey, todayDateKey, userTimezone);
        } catch (error) {
          console.error('[daily-update] Error calculating days difference:', error);
          daysDiff = 999; // Treat as gap
        }
      } else {
        daysDiff = 999; // No previous check-in, treat as first check-in
      }

      console.log('[daily-update] Streak calculation:', {
        todayDateKey,
        lastCheckinDayKey,
        daysDiff,
        userTimezone,
      });

      // Apply streak rules based on consecutive days and delta
      // Only rejuvenation streak is tracked (positive delta or neutral delta resets streak)
      if (daysDiff === 1) {
        // Consecutive day (yesterday): increment streak if rejuvenation
        if (actualDeltaYears <= -threshold) {
          // Rejuvenation: increment rejuvenation streak
          rejuvenationStreakDays = currentRejuvenationStreak + 1;
          totalRejuvenationDays += 1;
        } else {
          // Acceleration or neutral: reset streak
          rejuvenationStreakDays = 0;
        }
      } else {
        // Gap (2+ days) or first check-in: reset or start streak
        if (actualDeltaYears <= -threshold) {
          rejuvenationStreakDays = 1;
          totalRejuvenationDays += 1;
        } else {
          // Acceleration or neutral: no streak
          rejuvenationStreakDays = 0;
        }
      }
    }

    // Use Firestore transaction to ensure atomicity and prevent race conditions
    const userRef = firestore.collection('users').doc(userId);
    const dailyEntryRef = firestore.collection('users').doc(userId).collection('dailyEntries').doc(todayDateKey);

    await firestore.runTransaction(async (transaction) => {
      // Re-check if entry exists (within transaction)
      const entrySnapshot = await transaction.get(dailyEntryRef);
      if (entrySnapshot.exists) {
        throw new Error('Daily check-in already completed for this date');
      }

      // Re-read user document to get latest state (within transaction)
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists) {
        throw new Error('User not found');
      }

      const userData = userSnapshot.data();
      const currentLastCheckinDayKey = userData?.lastCheckinDayKey || null;

      // Verify we're using the correct lastCheckinDayKey (may have changed in transaction)
      if (currentLastCheckinDayKey && currentLastCheckinDayKey !== lastCheckinDayKey) {
        // Recalculate streak with updated lastCheckinDayKey
        const updatedDaysDiff = currentLastCheckinDayKey
          ? daysBetween(currentLastCheckinDayKey, todayDateKey, userTimezone)
          : 999;

        if (updatedDaysDiff === 1) {
          // Consecutive day
          if (actualDeltaYears <= -threshold) {
            rejuvenationStreakDays = (userData?.rejuvenationStreakDays ?? 0) + 1;
            totalRejuvenationDays = (userData?.totalRejuvenationDays ?? 0) + 1;
          } else {
            rejuvenationStreakDays = 0;
          }
        } else {
          // Gap or first check-in
          if (actualDeltaYears <= -threshold) {
            rejuvenationStreakDays = 1;
            totalRejuvenationDays = (userData?.totalRejuvenationDays ?? 0) + 1;
          } else {
            rejuvenationStreakDays = 0;
          }
        }
      }

      // Create daily entry
      const dailyEntryDoc: any = {
      userId,
        dateKey: todayDateKey,
        date: todayDateKey,
        sleepHours: metrics.sleepHours,
        steps: metrics.steps,
        vigorousMinutes: metrics.vigorousMinutes,
        processedFoodScore: metrics.processedFoodScore,
        alcoholUnits: metrics.alcoholUnits,
        stressLevel: metrics.stressLevel,
        lateCaffeine: metrics.lateCaffeine,
        screenLate: metrics.screenLate,
        bedtimeHour: metrics.bedtimeHour,
        score,
        deltaYears: actualDeltaYears,
        reasons,
        currentBiologicalAgeYears,
        currentAgingDebtYears,
        rejuvenationStreakDays,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      transaction.set(dailyEntryRef, dailyEntryDoc);

      // Update user document
      const now = new Date().toISOString();
      transaction.update(userRef, {
      currentBiologicalAgeYears,
      currentAgingDebtYears,
      rejuvenationStreakDays,
      totalRejuvenationDays,
        lastCheckinDayKey: todayDateKey,
        lastCheckinAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    const state: BiologicalAgeState = {
      chronologicalAgeYears,
      baselineBiologicalAgeYears,
      currentBiologicalAgeYears,
      agingDebtYears: currentAgingDebtYears,
      rejuvenationStreakDays,
      totalRejuvenationDays,
    };

    const today: TodayEntry = {
      date: todayDateKey,
      score,
      deltaYears,
      reasons,
    };

    const response: DailyUpdateResponse = {
      state,
      today,
    };

    console.log('[daily-update] result:', {
      userId,
      timezone: userTimezone,
      dateKey: todayDateKey,
      chronologicalAgeYears,
      baselineBiologicalAgeYears,
      currentBiologicalAgeYears,
      currentAgingDebtYears,
      score,
      deltaYears,
    });

    return res.json(response);
  } catch (error: any) {
    console.error('[daily-update] error:', error);
    
    // Handle specific error for duplicate entry (shouldn't happen due to pre-check, but handle anyway)
    if (error.message && error.message.includes('Daily check-in already completed')) {
      return res.status(409).json({
        error: 'Daily check-in already completed',
        message: error.message,
      });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/age/state/:userId', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;

    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      profile: {
        chronologicalAgeYears: user.chronologicalAgeYears,
        baselineBiologicalAgeYears: user.baselineBiologicalAgeYears,
      },
      state: {
        currentBiologicalAgeYears: user.currentBiologicalAgeYears,
        agingDebtYears: user.currentAgingDebtYears,
        rejuvenationStreakDays: user.rejuvenationStreakDays,
        totalRejuvenationDays: user.totalRejuvenationDays,
      },
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/age/morning-briefing', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const message = await generateAgeMessage(userId, 'morning');
    return res.json({ message });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/age/evening-briefing', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const message = await generateAgeMessage(userId, 'evening');
    return res.json({ message });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Score endpoints
app.post('/api/score/onboarding', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const { answers } = req.body;

    if (!answers) {
      return res
        .status(400)
        .json({ error: 'answers is required' });
    }

    const state = await setOnboardingScore(
      userId,
      answers as ScoreOnboardingAnswers
    );

    return res.json({
      baselineScore: state.baselineScore,
      currentScore: state.currentScore,
      breakdown: state.breakdown,
      insights: state.insights,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/score/daily', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;

    const typedMetrics = normalizeDailyMetrics(req.body);
    // Legacy score path expects old DailyMetrics shape; cast to keep compatibility.
    const updatedState = await updateScoreFromDaily(userId, typedMetrics as any);

    if (!updatedState) {
      return res
        .status(404)
        .json({ error: 'User score not found. Complete onboarding first.' });
    }

    return res.json({
      baselineScore: updatedState.baselineScore,
      currentScore: updatedState.currentScore,
      breakdown: updatedState.breakdown,
      insights: updatedState.insights,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/score/state/:userId', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;

    const state = getScoreState(userId);

    if (!state) {
      return res.status(404).json({ error: 'User score not found. Complete onboarding first.' });
    }

    return res.json({
      baselineScore: state.baselineScore,
      currentScore: state.currentScore,
      breakdown: state.breakdown,
      insights: state.insights,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/age/trend/:userId', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const range = (req.query.range as string) || 'weekly';

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    let limit: number;
    switch (range) {
      case 'weekly':
        limit = 7;
        break;
      case 'monthly':
        limit = 30;
        break;
      case 'yearly':
        limit = 365;
        break;
      default:
        return res.status(400).json({ error: 'Invalid range. Use weekly, monthly, or yearly' });
    }

    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    // Get user's timezone (default to UTC if not set)
    const userTimezone = user.timezone || 'UTC';

    const entries = await listDailyEntries(userId);
    const sortedEntries = entries
      .slice()
      .sort((a, b) => {
        const dateA = a.dateKey || a.date;
        const dateB = b.dateKey || b.date;
        return dateA.localeCompare(dateB);
      })
      .slice(-limit);

    // Create points from daily entries
    const entryPoints = sortedEntries.map((entry) => ({
      date: entry.dateKey || entry.date,
      biologicalAgeYears: entry.currentBiologicalAgeYears ?? user.currentBiologicalAgeYears,
      agingDebtYears:
        (entry.currentBiologicalAgeYears ?? user.currentBiologicalAgeYears) -
        user.chronologicalAgeYears,
    }));

    // Add onboarding baseline point if we have baseline data
    // Convert createdAt (UTC ISO string) to user's timezone dateKey (YYYY-MM-DD)
    // Use chronologicalAgeYearsAtOnboarding for accurate baseline delta calculation
    let onboardingPoint: { date: string; biologicalAgeYears: number; agingDebtYears: number } | null = null;
    
    if (user.baselineBiologicalAgeYears !== null && user.baselineBiologicalAgeYears !== undefined && user.createdAt) {
      try {
        // Parse createdAt as UTC and convert to user's timezone
        const createdAtUTC = DateTime.fromISO(user.createdAt, { zone: 'utc' });
        if (createdAtUTC.isValid) {
          const createdAtInUserTz = createdAtUTC.setZone(userTimezone);
          const onboardingDate = createdAtInUserTz.toISODate();
          
          if (onboardingDate) {
            // Use chronologicalAgeYearsAtOnboarding if available, otherwise fall back to current chronologicalAgeYears
            // This ensures we use the age at onboarding time for the baseline delta
            const chronologicalAgeAtOnboarding = user.chronologicalAgeYearsAtOnboarding ?? user.chronologicalAgeYears;
            const baselineAgingDebt = user.baselineBiologicalAgeYears - chronologicalAgeAtOnboarding;
            
            onboardingPoint = {
              date: onboardingDate,
              biologicalAgeYears: user.baselineBiologicalAgeYears,
              agingDebtYears: baselineAgingDebt,
            };
          }
        }
      } catch (error) {
        console.warn('[age/trend] Failed to parse onboarding date, falling back to UTC:', error);
        // Fallback: use UTC date if timezone conversion fails
        const onboardingDate = user.createdAt.split('T')[0];
        const chronologicalAgeAtOnboarding = user.chronologicalAgeYearsAtOnboarding ?? user.chronologicalAgeYears;
        const baselineAgingDebt = user.baselineBiologicalAgeYears - chronologicalAgeAtOnboarding;
        
        onboardingPoint = {
          date: onboardingDate,
          biologicalAgeYears: user.baselineBiologicalAgeYears,
          agingDebtYears: baselineAgingDebt,
        };
      }
    }

    // Combine onboarding point with entry points and sort by date
    let allPoints: Array<{ date: string; biologicalAgeYears: number; agingDebtYears: number }>;
    if (onboardingPoint) {
      allPoints = [onboardingPoint, ...entryPoints].sort((a, b) => a.date.localeCompare(b.date));
    } else {
      allPoints = entryPoints;
    }

    return res.json({
      range,
      points: allPoints,
        summary: {
        currentBiologicalAgeYears: user.currentBiologicalAgeYears,
        agingDebtYears: user.currentAgingDebtYears,
        rejuvenationStreakDays: user.rejuvenationStreakDays,
        totalRejuvenationDays: user.totalRejuvenationDays,
      },
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Longevity Scoring Engine API Endpoints
// ============================================

/**
 * POST /api/onboarding/submit
 * Submit onboarding answers and calculate baseline biological age.
 */
app.post('/api/onboarding/submit', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as OnboardingSubmitRequest;
    const userId = req.user!.uid;
    const { chronologicalAgeYears, answers } = body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (
      chronologicalAgeYears === undefined ||
      chronologicalAgeYears === null ||
      Number.isNaN(Number(chronologicalAgeYears))
    ) {
      return res.status(400).json({ error: 'chronologicalAgeYears is required' });
    }

    const requiredFields = [
      'activity',
      'smokingAlcohol',
      'metabolicHealth',
      'energyFocus',
      'visceralFat',
      'sleep',
      'stress',
      'muscle',
      'nutritionPattern',
      'sugar',
    ] as const;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object is required' });
    }

    for (const field of requiredFields) {
      if (answers[field] === undefined || answers[field] === null) {
        return res
          .status(400)
          .json({ error: `Missing answer for field: ${field}`, field: `answers.${field}` });
      }
      if (!Number.isFinite(Number(answers[field]))) {
        return res.status(400).json({ error: `Invalid number for field: ${field}` });
      }
    }

    // Check if onboarding is already completed
    const alreadyCompleted = await hasCompletedOnboarding(userId);
    if (alreadyCompleted) {
      return res.status(409).json({
        error: 'Onboarding already completed',
        message: 'User has already completed onboarding. To update onboarding data, please contact support.',
      });
    }

    const chronologicalAge = Number(chronologicalAgeYears);
    console.log('[onboarding] computeOnboardingResult start');
    const result = calculateOnboardingResult(answers, chronologicalAge);
    console.log('[onboarding] computeOnboardingResult done:', {
      chronologicalAge,
      totalScore: result.totalScore,
      BAOYears: result.BAOYears,
      baselineBiologicalAgeYears: result.baselineBiologicalAgeYears,
    });

    // Persist user root doc (baseline + current state). Keep chrono fixed.
    await upsertUserOnboarding({
      userId,
      chronologicalAgeYears: chronologicalAge,
      answers,
      onboardingTotalScore: result.totalScore,
      baselineBiologicalAgeYears: result.baselineBiologicalAgeYears,
      baselineBAOYears: result.BAOYears,
    });

    const response: OnboardingSubmitResponse = {
      userId,
      chronologicalAgeYears: chronologicalAge,
      baselineBiologicalAgeYears: result.baselineBiologicalAgeYears,
      currentBiologicalAgeYears: result.baselineBiologicalAgeYears,
      BAOYears: result.BAOYears,
      totalScore: result.totalScore,
    };

    console.log('[onboarding] success for userId:', userId, response);
    return res.json(response);
  } catch (error: any) {
    console.error('[onboarding] error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
    });
  }
});

/**
 * GET /api/debug/onboarding-status
 * Debug endpoint to check onboarding status for current user.
 */
app.get('/api/debug/onboarding-status', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const userDoc = await getUserDocument(userId);
    
    if (!userDoc) {
      return res.json({
        userId,
        userExists: false,
        hasCompletedOnboarding: false,
        onboardingAnswers: null,
        message: 'User document not found',
      });
    }
    
    const hasAnswers = !!(userDoc.onboardingAnswers && typeof userDoc.onboardingAnswers === 'object');
    const completed = await hasCompletedOnboarding(userId);
    
    return res.json({
      userId,
      userExists: true,
      hasCompletedOnboarding: completed,
      onboardingAnswers: userDoc.onboardingAnswers || null,
      onboardingAnswersType: typeof userDoc.onboardingAnswers,
      baselineBiologicalAgeYears: userDoc.baselineBiologicalAgeYears,
      onboardingTotalScore: userDoc.onboardingTotalScore,
      message: completed ? 'Onboarding completed' : 'Onboarding not completed',
    });
  } catch (error: any) {
    console.error('[debug/onboarding-status] error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/stats/summary?userId=
 * Returns biological age state and chart-friendly history arrays.
 */
app.get('/api/stats/summary', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  const startTime = Date.now();
  try {
    const userId = req.user!.uid;

    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    const baselineBiologicalAgeYears = user.baselineBiologicalAgeYears;
    const currentBiologicalAgeYears =
      user.currentBiologicalAgeYears ?? user.baselineBiologicalAgeYears;
    const state: BiologicalAgeState = {
      chronologicalAgeYears: user.chronologicalAgeYears,
      baselineBiologicalAgeYears,
      currentBiologicalAgeYears,
      agingDebtYears: currentBiologicalAgeYears - user.chronologicalAgeYears,
      rejuvenationStreakDays: user.rejuvenationStreakDays ?? 0,
      totalRejuvenationDays: user.totalRejuvenationDays ?? 0,
    };

    // Get today's dateKey in user's timezone
    const userTimezone = user.timezone || 'UTC';
    const todayDateKey = getTodayDateKey(userTimezone);
    const todayEntry = await getDailyEntry(userId, todayDateKey);

    const entries = await listDailyEntries(userId);
    // Sort by dateKey if available, otherwise fall back to date
    const sorted = entries.sort((a, b) => {
      const dateA = a.dateKey || a.date;
      const dateB = b.dateKey || b.date;
      return dateA.localeCompare(dateB);
    });

    // Aggregate history; use stored snapshots when available, otherwise accumulate.
    let runningBio = baselineBiologicalAgeYears;
    const history: HistoryPoint[] = sorted.map((entry) => {
      if (entry.currentBiologicalAgeYears !== undefined) {
        runningBio = entry.currentBiologicalAgeYears;
      } else {
        runningBio += entry.deltaYears;
      }
      return {
        date: entry.dateKey || entry.date,
        biologicalAgeYears: runningBio,
        deltaYears: entry.deltaYears,
        score: entry.score,
      };
    });

    // Calculate days ago using user's timezone for accurate date comparison
    const daysAgo = (dateStr: string) => {
      try {
        // Parse dateKey (YYYY-MM-DD) in user's timezone
        const dateInUserTz = DateTime.fromISO(dateStr, { zone: userTimezone });
        const todayInUserTz = DateTime.now().setZone(userTimezone);
        
        if (dateInUserTz.isValid && todayInUserTz.isValid) {
          const diff = todayInUserTz.startOf('day').diff(dateInUserTz.startOf('day'), 'days');
          return diff.as('days');
        }
      } catch (error) {
        console.warn('[stats/summary] Error calculating daysAgo, falling back to UTC:', error);
      }
      // Fallback to UTC calculation
      const diffMs = Date.now() - new Date(dateStr + 'T00:00:00Z').getTime();
      return diffMs / (1000 * 60 * 60 * 24);
    };

    const weeklyHistory = history.filter((h) => daysAgo(h.date) <= 14);
    const monthlyHistory = history.filter((h) => daysAgo(h.date) <= 60);
    const yearlyHistory = history.filter((h) => daysAgo(h.date) <= 365);

    const completedOnboarding = await hasCompletedOnboarding(userId);

    const response: StatsSummaryResponse = {
      userId,
      state,
      today: todayEntry
        ? {
            date: todayEntry.dateKey || todayEntry.date,
            score: todayEntry.score,
            deltaYears: todayEntry.deltaYears,
            reasons: todayEntry.reasons,
          }
        : undefined,
      weeklyHistory,
      monthlyHistory,
      yearlyHistory,
      hasCompletedOnboarding: completedOnboarding,
    };

    console.log('[stats/summary] Response ready in', Date.now() - startTime, 'ms', {
      weeklyPoints: weeklyHistory.length,
      monthlyPoints: monthlyHistory.length,
      yearlyPoints: yearlyHistory.length,
      currentBiologicalAgeYears: state.currentBiologicalAgeYears,
    });

    return res.json(response);
  } catch (error: any) {
    console.error('[stats/summary] error after', Date.now() - startTime, 'ms:', error);
    return res.status(500).json({
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
    });
  }
});

/**
 * Helper function to round to 2 decimals
 */
function roundTo2Decimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate 0-100 score for sleep hours
 * Optimal: 7-9 hours = 100
 * 6-7 or 9-10 = 70
 * <6 or >10 = 30
 */
function calculateSleepHoursScore(sleepHours: number): number {
  if (sleepHours >= 7 && sleepHours <= 9) {
    return 100;
  } else if ((sleepHours >= 6 && sleepHours < 7) || (sleepHours > 9 && sleepHours <= 10)) {
    return 70;
  } else if (sleepHours < 6) {
    // Less than 6 hours: linear from 0-6
    return Math.max(0, Math.min(30, (sleepHours / 6) * 30));
  } else {
    // More than 10 hours: linear from 10-12
    return Math.max(0, Math.min(30, ((12 - sleepHours) / 2) * 30));
  }
}

/**
 * Calculate 0-100 score for steps
 * 10000+ = 100
 * 7000-9999 = 80
 * 5000-6999 = 60
 * 3000-4999 = 40
 * <3000 = 20
 */
function calculateStepsScore(steps: number): number {
  if (steps >= 10000) {
    return 100;
  } else if (steps >= 7000) {
    return 80;
  } else if (steps >= 5000) {
    return 60;
  } else if (steps >= 3000) {
    return 40;
  } else {
    return Math.max(0, Math.min(20, (steps / 3000) * 20));
  }
}

/**
 * Calculate 0-100 score for vigorous minutes
 * 30+ = 100
 * 20-29 = 80
 * 10-19 = 60
 * 5-9 = 40
 * <5 = 20
 */
function calculateVigorousMinutesScore(minutes: number): number {
  if (minutes >= 30) {
    return 100;
  } else if (minutes >= 20) {
    return 80;
  } else if (minutes >= 10) {
    return 60;
  } else if (minutes >= 5) {
    return 40;
  } else {
    return Math.max(0, Math.min(20, (minutes / 5) * 20));
  }
}

/**
 * Calculate 0-100 score for processed food (1-5 scale, lower is better)
 * 1 = 100
 * 2 = 80
 * 3 = 50
 * 4 = 20
 * 5 = 0
 */
function calculateProcessedFoodScore(processedFoodScore: number): number {
  if (processedFoodScore <= 1) {
    return 100;
  } else if (processedFoodScore <= 2) {
    return 80;
  } else if (processedFoodScore <= 3) {
    return 50;
  } else if (processedFoodScore <= 4) {
    return 20;
  } else {
    return 0;
  }
}

/**
 * Calculate 0-100 score for alcohol units
 * 0 = 100
 * 1 = 80
 * 2 = 60
 * 3 = 40
 * 4+ = 0
 */
function calculateAlcoholUnitsScore(alcoholUnits: number): number {
  if (alcoholUnits === 0) {
    return 100;
  } else if (alcoholUnits === 1) {
    return 80;
  } else if (alcoholUnits === 2) {
    return 60;
  } else if (alcoholUnits === 3) {
    return 40;
  } else {
    return Math.max(0, 40 - (alcoholUnits - 3) * 10);
  }
}

/**
 * Calculate 0-100 score for stress level (1-10 scale, lower is better)
 * 1-2 = 100
 * 3-4 = 80
 * 5-6 = 50
 * 7-8 = 20
 * 9-10 = 0
 */
function calculateStressLevelScore(stressLevel: number): number {
  if (stressLevel <= 2) {
    return 100;
  } else if (stressLevel <= 4) {
    return 80;
  } else if (stressLevel <= 6) {
    return 50;
  } else if (stressLevel <= 8) {
    return 20;
  } else {
    return 0;
  }
}

/**
 * Calculate 0-100 score for late caffeine (boolean)
 * false = 100, true = 0
 */
function calculateLateCaffeineScore(lateCaffeine: boolean): number {
  return lateCaffeine ? 0 : 100;
}

/**
 * Calculate 0-100 score for late screen (boolean)
 * false = 100, true = 0
 */
function calculateScreenLateScore(screenLate: boolean): number {
  return screenLate ? 0 : 100;
}

/**
 * Calculate 0-100 score for bedtime hour
 * 20-22 = 100 (optimal)
 * 22-23 = 80
 * 19-20 = 70
 * 23-24 = 50
 * <19 or >24 = 20
 */
function calculateBedtimeHourScore(bedtimeHour: number): number {
  if (bedtimeHour >= 20 && bedtimeHour <= 22) {
    return 100;
  } else if (bedtimeHour > 22 && bedtimeHour <= 23) {
    return 80;
  } else if (bedtimeHour >= 19 && bedtimeHour < 20) {
    return 70;
  } else if (bedtimeHour > 23 && bedtimeHour <= 24) {
    return 50;
  } else {
    return 20;
  }
}

/**
 * Calculate metric scores from daily entries
 */
function calculateMetricScores(entries: DailyEntryDocument[]): {
  scores: MetricScores;
  averages: MetricsScoresResponse['averages'];
} {
  if (entries.length === 0) {
    return {
      scores: {
        sleepHours: 0,
        steps: 0,
        vigorousMinutes: 0,
        processedFoodScore: 0,
        alcoholUnits: 0,
        stressLevel: 0,
        lateCaffeine: 0,
        screenLate: 0,
        bedtimeHour: 0,
      },
      averages: {
        sleepHours: 0,
        steps: 0,
        vigorousMinutes: 0,
        processedFoodScore: 0,
        alcoholUnits: 0,
        stressLevel: 0,
        lateCaffeine: 0,
        screenLate: 0,
        bedtimeHour: 0,
      },
    };
  }

  // Calculate averages
  const sum = entries.reduce(
    (acc, entry) => ({
      sleepHours: acc.sleepHours + (entry.sleepHours || 0),
      steps: acc.steps + (entry.steps || 0),
      vigorousMinutes: acc.vigorousMinutes + (entry.vigorousMinutes || 0),
      processedFoodScore: acc.processedFoodScore + (entry.processedFoodScore || 0),
      alcoholUnits: acc.alcoholUnits + (entry.alcoholUnits || 0),
      stressLevel: acc.stressLevel + (entry.stressLevel || 0),
      lateCaffeine: acc.lateCaffeine + (entry.lateCaffeine ? 1 : 0),
      screenLate: acc.screenLate + (entry.screenLate ? 1 : 0),
      bedtimeHour: acc.bedtimeHour + (entry.bedtimeHour || 0),
    }),
    {
      sleepHours: 0,
      steps: 0,
      vigorousMinutes: 0,
      processedFoodScore: 0,
      alcoholUnits: 0,
      stressLevel: 0,
      lateCaffeine: 0,
      screenLate: 0,
      bedtimeHour: 0,
    }
  );

  const count = entries.length;
  const averages = {
    sleepHours: roundTo2Decimals(sum.sleepHours / count),
    steps: roundTo2Decimals(sum.steps / count),
    vigorousMinutes: roundTo2Decimals(sum.vigorousMinutes / count),
    processedFoodScore: roundTo2Decimals(sum.processedFoodScore / count),
    alcoholUnits: roundTo2Decimals(sum.alcoholUnits / count),
    stressLevel: roundTo2Decimals(sum.stressLevel / count),
    lateCaffeine: roundTo2Decimals(sum.lateCaffeine / count), // percentage
    screenLate: roundTo2Decimals(sum.screenLate / count), // percentage
    bedtimeHour: roundTo2Decimals(sum.bedtimeHour / count),
  };

  // Calculate scores based on averages
  const scores: MetricScores = {
    sleepHours: Math.round(calculateSleepHoursScore(averages.sleepHours)),
    steps: Math.round(calculateStepsScore(averages.steps)),
    vigorousMinutes: Math.round(calculateVigorousMinutesScore(averages.vigorousMinutes)),
    processedFoodScore: Math.round(calculateProcessedFoodScore(averages.processedFoodScore)),
    alcoholUnits: Math.round(calculateAlcoholUnitsScore(averages.alcoholUnits)),
    stressLevel: Math.round(calculateStressLevelScore(averages.stressLevel)),
    lateCaffeine: Math.round((1 - averages.lateCaffeine) * 100), // percentage of days without late caffeine
    screenLate: Math.round((1 - averages.screenLate) * 100), // percentage of days without late screen
    bedtimeHour: Math.round(calculateBedtimeHourScore(averages.bedtimeHour)),
  };

  return { scores, averages };
}

/**
 * Calculate trend period data
 * If entries.length < requiredDays but >= 2, calculate trend from first to last entry
 * This allows showing graphs even with limited data
 */
function calculateTrendPeriod(
  entries: DailyEntryDocument[],
  requiredDays: number,
  pointsCount: number
): TrendPeriod {
  // Always return points if we have any entries
  const points: TrendPoint[] = entries
    .slice(-pointsCount)
    .map((e) => ({
      date: e.dateKey || e.date,
      biologicalAge: roundTo2Decimals(e.currentBiologicalAgeYears ?? 0),
    }));

  // If we have less than required days, calculate partial trend (first to last)
  if (entries.length < requiredDays) {
    // If we have at least 2 entries, calculate trend from first to last
    if (entries.length >= 2) {
      const firstEntry = entries[0];
      const lastEntry = entries[entries.length - 1];
      
      const firstBioAge = firstEntry.currentBiologicalAgeYears ?? 0;
      const lastBioAge = lastEntry.currentBiologicalAgeYears ?? 0;
      const value = roundTo2Decimals(lastBioAge - firstBioAge);

      return {
        value,
        available: false, // Not enough data for full period, but we have a partial trend
        points,
      };
    }
    
    // Less than 2 entries - no trend to calculate
    return {
      value: null,
      available: false,
      points,
    };
  }

  // We have enough entries for full period calculation
  const todayEntry = entries[entries.length - 1];
  const pastEntry = entries[entries.length - requiredDays];
  
  const todayBioAge = todayEntry.currentBiologicalAgeYears ?? 0;
  const pastBioAge = pastEntry.currentBiologicalAgeYears ?? 0;
  const value = roundTo2Decimals(todayBioAge - pastBioAge);

  return {
    value,
    available: true,
    points,
  };
}

/**
 * Delta Analytics Helper Functions
 */

/**
 * Get week range (Monday to Sunday) for a given date in user's timezone
 * Luxon's startOf('week') uses Monday as the first day (ISO 8601 standard)
 */
function getWeekRange(date: DateTime, timezone: string): { start: string; end: string } {
  const dt = date.setZone(timezone);
  // Get Monday of the week (Luxon uses ISO 8601, so Monday = weekday 1)
  const monday = dt.startOf('week');
  const sunday = monday.plus({ days: 6 });
  return {
    start: monday.toISODate()!,
    end: sunday.toISODate()!,
  };
}

/**
 * Get month range (first day to last day) for a given date in user's timezone
 */
function getMonthRange(date: DateTime, timezone: string): { start: string; end: string } {
  const dt = date.setZone(timezone);
  const firstDay = dt.startOf('month');
  const lastDay = dt.endOf('month');
  return {
    start: firstDay.toISODate()!,
    end: lastDay.toISODate()!,
  };
}

/**
 * Get year range (January 1 to December 31) for a given date in user's timezone
 */
function getYearRange(date: DateTime, timezone: string): { start: string; end: string } {
  const dt = date.setZone(timezone);
  const firstDay = dt.startOf('year');
  const lastDay = dt.endOf('year');
  return {
    start: firstDay.toISODate()!,
    end: lastDay.toISODate()!,
  };
}

/**
 * Generate all dates in a range (inclusive)
 */
function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const startDate = DateTime.fromISO(start);
  const endDate = DateTime.fromISO(end);
  let current = startDate;
  
  while (current <= endDate) {
    dates.push(current.toISODate()!);
    current = current.plus({ days: 1 });
  }
  
  return dates;
}

/**
 * Generate all months in a year range
 */
function generateMonthRange(start: string, end: string): string[] {
  const months: string[] = [];
  const startDate = DateTime.fromISO(start);
  const endDate = DateTime.fromISO(end);
  let current = startDate.startOf('month');
  
  while (current <= endDate) {
    months.push(current.toFormat('yyyy-MM'));
    current = current.plus({ months: 1 });
  }
  
  return months;
}

/**
 * Calculate summary from entries in a specific range
 * Note: deltaYears in system: negative = rejuvenation, positive = aging
 * For analytics: we invert to match user definition (positive = rejuvenation, negative = aging)
 */
function calculateRangeDeltaSummary(entries: DailyEntryDocument[]): {
  rangeNetDeltaYears: number;
  rejuvenationYears: number;
  agingYears: number;
  checkIns: number;
} {
  let rangeNetDelta = 0;
  let rejuvenation = 0;
  let aging = 0;
  
  entries.forEach((entry) => {
    // Invert deltaYears: negative deltaYears (rejuvenation) becomes positive delta
    // positive deltaYears (aging) becomes negative delta
    const delta = -(entry.deltaYears || 0);
    rangeNetDelta += delta;
    
    // rejuvenation = sum(max(delta, 0)) - positive deltas
    if (delta > 0) {
      rejuvenation += delta;
    }
    // aging = sum(abs(min(delta, 0))) - negative deltas (as positive)
    else if (delta < 0) {
      aging += Math.abs(delta);
    }
  });
  
  const checkIns = entries.length;
  
  return {
    rangeNetDeltaYears: roundTo2Decimals(rangeNetDelta),
    rejuvenationYears: roundTo2Decimals(rejuvenation),
    agingYears: roundTo2Decimals(aging),
    checkIns,
  };
}

/**
 * Calculate total delta summary (baseline + all daily deltas from onboarding)
 * Returns total values including baseline
 */
function calculateTotalDeltaSummary(
  baselineDeltaYears: number,
  allEntries: DailyEntryDocument[]
): {
  netDeltaYears: number;
  rejuvenationYears: number;
  agingYears: number;
} {
  let totalDailyDelta = 0;
  let totalRejuvenation = 0;
  let totalAging = 0;
  
  allEntries.forEach((entry) => {
    // Invert deltaYears: negative deltaYears (rejuvenation) becomes positive delta
    const delta = -(entry.deltaYears || 0);
    totalDailyDelta += delta;
    
    // Track rejuvenation (positive deltas) and aging (negative deltas)
    if (delta > 0) {
      totalRejuvenation += delta;
    } else if (delta < 0) {
      totalAging += Math.abs(delta);
    }
  });
  
  // netDeltaYears = baseline + all daily deltas
  const netDeltaYears = baselineDeltaYears + totalDailyDelta;
  
  // Rejuvenation and aging are only from daily deltas (baseline is separate)
  // But if baseline is negative (rejuvenation), we could add it to rejuvenation
  // However, per requirements, we show total including baseline in netDeltaYears
  // and separate rejuvenation/aging from daily deltas only
  
  return {
    netDeltaYears: roundTo2Decimals(netDeltaYears),
    rejuvenationYears: roundTo2Decimals(totalRejuvenation),
    agingYears: roundTo2Decimals(totalAging),
  };
}

/**
 * Aggregate deltas by date
 * Note: Return dailyDeltaYears (inverted from system deltaYears)
 * System: negative deltaYears = rejuvenation, positive = aging
 * Analytics: positive dailyDeltaYears = rejuvenation, negative = aging
 */
function aggregateDeltasByDate(
  entries: DailyEntryDocument[],
  dateRange: string[]
): DeltaSeriesPoint[] {
  // Create a map of dateKey -> sum of dailyDeltaYears (inverted)
  const deltaMap = new Map<string, number>();
  
  entries.forEach((entry) => {
    const dateKey = entry.dateKey || entry.date;
    const currentSum = deltaMap.get(dateKey) || 0;
    // Invert: negative deltaYears (rejuvenation) becomes positive dailyDeltaYears
    const dailyDeltaYears = -(entry.deltaYears || 0);
    deltaMap.set(dateKey, currentSum + dailyDeltaYears);
  });
  
  // Generate series with null for missing dates
  return dateRange.map((date) => ({
    date,
    dailyDeltaYears: deltaMap.has(date) ? roundTo2Decimals(deltaMap.get(date)!) : null,
  }));
}

/**
 * Aggregate deltas by month
 * Note: Return netDeltaYears (inverted from system deltaYears)
 */
function aggregateDeltasByMonth(
  entries: DailyEntryDocument[],
  monthRange: string[]
): MonthlyDeltaSeriesPoint[] {
  // Group entries by month (YYYY-MM)
  const monthMap = new Map<string, DailyEntryDocument[]>();
  
  entries.forEach((entry) => {
    const dateKey = entry.dateKey || entry.date;
    const month = DateTime.fromISO(dateKey).toFormat('yyyy-MM');
    if (!monthMap.has(month)) {
      monthMap.set(month, []);
    }
    monthMap.get(month)!.push(entry);
  });
  
  // Generate series for each month
  return monthRange.map((month) => {
    const monthEntries = monthMap.get(month) || [];
    // Invert: negative deltaYears (rejuvenation) becomes positive netDeltaYears
    const netDeltaYears = monthEntries.reduce((sum, e) => sum + (-(e.deltaYears || 0)), 0);
    const checkIns = monthEntries.length;
    const avgDeltaPerCheckIn = checkIns > 0 ? netDeltaYears / checkIns : 0;
    
    return {
      month,
      netDelta: roundTo2Decimals(netDeltaYears),
      checkIns,
      avgDeltaPerCheckIn: roundTo2Decimals(avgDeltaPerCheckIn),
    };
  });
}

/**
 * Filter entries within date range (inclusive)
 */
function filterEntriesInRange(
  entries: DailyEntryDocument[],
  start: string,
  end: string
): DailyEntryDocument[] {
  return entries.filter((entry) => {
    const dateKey = entry.dateKey || entry.date;
    return dateKey >= start && dateKey <= end;
  });
}

/**
 * Calculate yearly projection
 * Requires at least 7 days of data for a meaningful projection
 */
function calculateYearlyProjection(entries: DailyEntryDocument[]): TrendPeriod {
  // Get valid deltas (non-null, non-undefined, and non-zero for first entry)
  // First entry typically has deltaYears = 0 (no previous entry), so we filter it out
  const validDeltas = entries
    .map((e) => e.deltaYears)
    .filter((d) => d !== null && d !== undefined && !isNaN(d) && d !== 0);

  // Need at least 7 days of actual delta data for meaningful projection
  // For less than 7 days, we don't provide a projection (too unreliable)
  if (validDeltas.length < 7) {
    // Return null value but still provide points for chart display
    return {
      value: null,
      available: false,
      projection: true,
      points: entries.slice(-90).map((e) => ({
        date: e.dateKey || e.date,
        biologicalAge: roundTo2Decimals(e.currentBiologicalAgeYears ?? 0),
      })),
    };
  }

  // We have at least 7 days of delta data - use average delta for projection
  // Use last min(30, N) deltas for projection
  const deltasForProjection = validDeltas.slice(-Math.min(30, validDeltas.length));
  const averageDelta = deltasForProjection.reduce((sum, d) => sum + d, 0) / deltasForProjection.length;
  const projectedYearly = roundTo2Decimals(averageDelta * 365);

  // Points: last min(90, N) entries
  const pointsCount = Math.min(90, entries.length);
  const points: TrendPoint[] = entries.slice(-pointsCount).map((e) => ({
    date: e.dateKey || e.date,
    biologicalAge: roundTo2Decimals(e.currentBiologicalAgeYears ?? 0),
  }));

  return {
    value: projectedYearly,
    available: false,
    projection: true,
    points,
  };
}

/**
 * GET /api/longevity/trends
 * Returns weekly, monthly, and yearly trend data for the Score screen.
 * 
 * Response format:
 * {
 *   "weekly": { "value": -0.32, "available": true, "points": [...] },
 *   "monthly": { "value": -1.10, "available": true, "points": [...] },
 *   "yearly": { "value": -4.20, "available": false, "projection": true, "points": [...] }
 * }
 */
app.get('/api/longevity/trends', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get user document to verify user exists
    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    // Get up to 365 daily entries, sorted by date ascending
    const entries = await getDailyEntriesForTrends(userId, 365);
    
    console.log('[trends] Found', entries.length, 'entries for userId:', userId);

    // Calculate weekly trend (requires >= 7 entries)
    const weekly = calculateTrendPeriod(entries, 7, 7);

    // Calculate monthly trend (requires >= 30 entries)
    const monthly = calculateTrendPeriod(entries, 30, 30);

    // Calculate yearly trend
    let yearly: TrendPeriod;
    if (entries.length >= 365) {
      // Actual yearly data
      yearly = calculateTrendPeriod(entries, 365, 90);
      yearly.projection = false;
    } else {
      // Projection based on average delta
      yearly = calculateYearlyProjection(entries);
    }

    const response: TrendResponse = {
      weekly,
      monthly,
      yearly,
    };

    console.log('[trends] Response:', {
      weekly: { value: weekly.value, available: weekly.available },
      monthly: { value: monthly.value, available: monthly.available },
      yearly: { value: yearly.value, available: yearly.available, projection: yearly.projection },
    });

    return res.json(response);
  } catch (error: any) {
    console.error('[trends] error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
    });
  }
});

/**
 * GET /api/analytics/delta?range=weekly|monthly|yearly
 * Returns delta analytics for the Score screen graph.
 * 
 * Response format depends on range:
 * - weekly/monthly: series with daily delta values
 * - yearly: series with monthly netDelta values
 */
app.get('/api/analytics/delta', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const range = (req.query.range as string) || 'weekly';

    if (!['weekly', 'monthly', 'yearly'].includes(range)) {
      return res.status(400).json({ error: 'Invalid range. Use weekly, monthly, or yearly' });
    }

    // Get user document
    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    const userTimezone = user.timezone || 'UTC';
    
    // Calculate baselineDeltaYears: baselineBiologicalAge - chronologicalAge
    const baselineDeltaYears = roundTo2Decimals(
      user.baselineBiologicalAgeYears - user.chronologicalAgeYears
    );
    
    // Get all entries from onboarding to date
    const allEntries = await listDailyEntries(userId);
    
    // Use currentAgingDebtYears as the source of truth for netDeltaYears
    // This ensures consistency with the Aging Debt displayed elsewhere in the app
    const currentAgingDebtYears = user.currentAgingDebtYears ?? baselineDeltaYears;
    const totalDeltaYears = roundTo2Decimals(currentAgingDebtYears);
    
    // Calculate total summary for rejuvenation/aging breakdown
    const totalSummary = calculateTotalDeltaSummary(baselineDeltaYears, allEntries);
    
    // Get current date in user's timezone
    const now = DateTime.now().setZone(userTimezone);
    
    let response: DeltaAnalyticsResponse;
    
    if (range === 'weekly') {
      // Get current week range (Monday to Sunday)
      const weekRange = getWeekRange(now, userTimezone);
      const dateRange = generateDateRange(weekRange.start, weekRange.end);
      const entriesInRange = filterEntriesInRange(allEntries, weekRange.start, weekRange.end);
      
      const series = aggregateDeltasByDate(entriesInRange, dateRange);
      const rangeSummary = calculateRangeDeltaSummary(entriesInRange);
      
      // Combine total summary with range summary
      const summary: DeltaSummary = {
        netDeltaYears: totalDeltaYears, // Total from baseline + all daily deltas
        rejuvenationYears: totalSummary.rejuvenationYears,
        agingYears: totalSummary.agingYears,
        checkIns: rangeSummary.checkIns,
        rangeNetDeltaYears: rangeSummary.rangeNetDeltaYears, // Only range delta
      };
      
      response = {
        range: 'weekly',
        timezone: userTimezone,
        baselineDeltaYears,
        totalDeltaYears,
        start: weekRange.start,
        end: weekRange.end,
        series,
        summary,
      };
    } else if (range === 'monthly') {
      // Get current month range
      const monthRange = getMonthRange(now, userTimezone);
      const dateRange = generateDateRange(monthRange.start, monthRange.end);
      const entriesInRange = filterEntriesInRange(allEntries, monthRange.start, monthRange.end);
      
      const series = aggregateDeltasByDate(entriesInRange, dateRange);
      const rangeSummary = calculateRangeDeltaSummary(entriesInRange);
      
      const summary: DeltaSummary = {
        netDeltaYears: totalDeltaYears,
        rejuvenationYears: totalSummary.rejuvenationYears,
        agingYears: totalSummary.agingYears,
        checkIns: rangeSummary.checkIns,
        rangeNetDeltaYears: rangeSummary.rangeNetDeltaYears,
      };
      
      response = {
        range: 'monthly',
        timezone: userTimezone,
        baselineDeltaYears,
        totalDeltaYears,
        start: monthRange.start,
        end: monthRange.end,
        series,
        summary,
      };
    } else {
      // yearly
      // Get current year range
      const yearRange = getYearRange(now, userTimezone);
      const monthRange = generateMonthRange(yearRange.start, yearRange.end);
      const entriesInRange = filterEntriesInRange(allEntries, yearRange.start, yearRange.end);
      
      const series = aggregateDeltasByMonth(entriesInRange, monthRange);
      const rangeSummary = calculateRangeDeltaSummary(entriesInRange);
      
      const summary: DeltaSummary = {
        netDeltaYears: totalDeltaYears,
        rejuvenationYears: totalSummary.rejuvenationYears,
        agingYears: totalSummary.agingYears,
        checkIns: rangeSummary.checkIns,
        rangeNetDeltaYears: rangeSummary.rangeNetDeltaYears,
      };
      
      response = {
        range: 'yearly',
        timezone: userTimezone,
        baselineDeltaYears,
        totalDeltaYears,
        start: yearRange.start,
        end: yearRange.end,
        series,
        summary,
      };
    }

    // Log response structure for debugging
    const responseForLog = {
      range: response.range,
      timezone: response.timezone,
      baselineDeltaYears: response.baselineDeltaYears,
      totalDeltaYears: response.totalDeltaYears,
      start: response.start,
      end: response.end,
      seriesLength: range === 'yearly' 
        ? (response as YearlyDeltaResponse).series.length
        : (response as WeeklyDeltaResponse | MonthlyDeltaResponse).series.length,
      seriesSample: range === 'yearly'
        ? (response as YearlyDeltaResponse).series.slice(0, 2)
        : (response as WeeklyDeltaResponse | MonthlyDeltaResponse).series.slice(0, 2),
      summary: response.summary,
    };

    console.log('[analytics/delta] Response:', JSON.stringify(responseForLog, null, 2));

    return res.json(response);
  } catch (error: any) {
    console.error('[analytics/delta] error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
    });
  }
});

/**
 * GET /api/legal/privacy
 * Returns current Privacy Policy (English with Turkish KVKK section)
 * Public endpoint - no authentication required
 */
app.get('/api/legal/privacy', async (req, res) => {
  try {
    const privacyPolicy = getPrivacyPolicy();
    return res.json(privacyPolicy);
  } catch (error: any) {
    console.error('[legal/privacy] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/legal/terms
 * Returns current Terms of Service
 * Public endpoint - no authentication required
 */
app.get('/api/legal/terms', async (req, res) => {
  try {
    const terms = getTermsOfService();
    return res.json(terms);
  } catch (error: any) {
    console.error('[legal/terms] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/legal/consent
 * Record user consent for legal documents
 * Protected endpoint - requires authentication
 * Body: { acceptedPrivacyPolicyVersion?: string, acceptedTermsVersion?: string }
 */
app.post('/api/legal/consent', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const { acceptedPrivacyPolicyVersion, acceptedTermsVersion } = req.body || {};

    await recordConsent(userId, acceptedPrivacyPolicyVersion, acceptedTermsVersion);

    return res.json({
      success: true,
      message: 'Consent recorded successfully.',
    });
  } catch (error: any) {
    console.error('[legal/consent] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/legal/consent
 * Get user's consent record
 * Protected endpoint - requires authentication
 */
app.get('/api/legal/consent', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const consent = await getConsentRecord(userId);
    const needsUpdate = await needsConsentUpdate(userId);

    return res.json({
      consent: consent || null,
      needsUpdate,
    });
  } catch (error: any) {
    console.error('[legal/consent] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/subscription/verify
 * Verify Apple receipt and update subscription status
 * Protected endpoint - requires authentication
 * Body: { receiptData: string } (Base64-encoded receipt)
 */
app.post('/api/subscription/verify', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const { receiptData } = req.body;

    if (!receiptData || typeof receiptData !== 'string') {
      return res.status(400).json({ error: 'receiptData is required' });
    }

    const subscriptionState = await verifyAndUpdateSubscription(userId, receiptData);

    if (!subscriptionState) {
      return res.status(400).json({
        error: 'invalid_receipt',
        message: 'No valid subscription found in receipt.',
      });
    }

    return res.json({
      success: true,
      subscription: subscriptionState,
    });
  } catch (error: any) {
    console.error('[subscription/verify] error:', error);
    
    if (error.message && error.message.includes('status:')) {
      return res.status(400).json({
        error: 'invalid_receipt',
        message: 'Receipt validation failed. Please try again.',
      });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/subscription/status
 * Get user's current subscription status
 * Protected endpoint - requires authentication
 */
app.get('/api/subscription/status', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const subscription = await getSubscriptionStatus(userId);

    // Map subscription status to display name for Profile screen
    const membershipDisplayName = subscription.status === 'active' ? 'Longevity Premium' : 'Free';

    return res.json({
      subscription: {
        status: subscription.status,
        plan: subscription.plan,
        renewalDate: subscription.renewalDate,
        membershipDisplayName, // "Free" or "Longevity Premium"
      },
    });
  } catch (error: any) {
    console.error('[subscription/status] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/scores
 * Get 0-100 scores for each health metric based on user's daily check-in data
 * Protected endpoint - requires authentication and subscription
 * Response: MetricsScoresResponse with scores, averages, and data period
 */
app.get('/api/metrics/scores', requireAuth, requireSubscription, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const user = await getUserDocument(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    // Get all daily entries
    const allEntries = await listDailyEntries(userId);
    
    if (allEntries.length === 0) {
      return res.json({
        userId,
        scores: {
          sleepHours: 0,
          steps: 0,
          vigorousMinutes: 0,
          processedFoodScore: 0,
          alcoholUnits: 0,
          stressLevel: 0,
          lateCaffeine: 0,
          screenLate: 0,
          bedtimeHour: 0,
        },
        averages: {
          sleepHours: 0,
          steps: 0,
          vigorousMinutes: 0,
          processedFoodScore: 0,
          alcoholUnits: 0,
          stressLevel: 0,
          lateCaffeine: 0,
          screenLate: 0,
          bedtimeHour: 0,
        },
        dataPoints: 0,
        period: {
          start: '',
          end: '',
        },
      } as MetricsScoresResponse);
    }

    // Calculate scores from all entries
    const { scores, averages } = calculateMetricScores(allEntries);

    // Get date range
    const sortedEntries = allEntries.sort((a, b) => {
      const dateA = a.dateKey || a.date;
      const dateB = b.dateKey || b.date;
      return dateA.localeCompare(dateB);
    });

    const start = sortedEntries[0].dateKey || sortedEntries[0].date;
    const end = sortedEntries[sortedEntries.length - 1].dateKey || sortedEntries[sortedEntries.length - 1].date;

    const response: MetricsScoresResponse = {
      userId,
      scores,
      averages,
      dataPoints: allEntries.length,
      period: {
        start,
        end,
      },
    };

    return res.json(response);
  } catch (error: any) {
    console.error('[metrics/scores] error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
    });
  }
});

/**
 * POST /api/subscription/test-bypass
 * TEST ONLY: Bypass subscription requirement by setting user to active yearly subscription
 * This endpoint should only be available in development/test environments
 * Protected endpoint - requires authentication
 * Response: { success: true, subscription: { status, plan, renewalDate } }
 */
app.post('/api/subscription/test-bypass', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    // Only allow in development/test environments
    const nodeEnv = process.env.NODE_ENV || 'development';
    if (nodeEnv === 'production') {
      return res.status(403).json({
        error: 'forbidden',
        message: 'This endpoint is not available in production.',
      });
    }

    const userId = req.user!.uid;

    // Set subscription to active yearly membership
    const renewalDate = new Date();
    renewalDate.setFullYear(renewalDate.getFullYear() + 1); // 1 year from now

    const updates = {
      subscriptionStatus: 'active' as const,
      subscriptionPlan: 'membership_yearly' as const,
      subscriptionRenewalDate: renewalDate.toISOString(),
      subscriptionOriginalTransactionId: `test-bypass-${userId}-${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };

    await firestore.collection('users').doc(userId).set(updates, { merge: true });

    console.log(`[subscription/test-bypass] Activated test subscription for user: ${userId}`);

    return res.json({
      success: true,
      subscription: {
        status: 'active',
        plan: 'membership_yearly',
        renewalDate: renewalDate.toISOString(),
        membershipDisplayName: 'Longevity Premium',
      },
      message: 'Test subscription activated. User now has active yearly membership.',
    });
  } catch (error: any) {
    console.error('[subscription/test-bypass] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/subscription/apple-notification
 * Webhook endpoint for Apple Server-to-Server Notifications
 * Public endpoint (Apple will call this)
 * Body: Apple notification payload
 */
app.post('/api/subscription/apple-notification', async (req, res) => {
  try {
    const notification = req.body;

    // Verify this is a valid Apple notification (optional: verify signature)
    // For now, we'll trust the payload structure
    if (!notification || !notification.notification_type) {
      return res.status(400).json({ error: 'Invalid notification format' });
    }

    // Handle notification asynchronously (don't block response)
    handleAppleNotification(notification).catch((error) => {
      console.error('[subscription/apple-notification] Error processing notification:', error);
    });

    // Always return 200 to Apple immediately
    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[subscription/apple-notification] error:', error);
    // Still return 200 to Apple to avoid retries
    return res.status(200).json({ received: true, error: 'Processing failed' });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`thelongevityapp-backend listening on :${PORT}`);
  try {
    await ingestKnowledgeDir();
    console.log('Knowledge ingested on startup');
  } catch (error) {
    console.error('Error ingesting knowledge on startup:', error);
  }
});

