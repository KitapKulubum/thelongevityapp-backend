import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { firestore } from '../config/firestore';
import { sendPasswordResetOTP } from './emailService';
import * as jwt from 'jsonwebtoken';
import { validatePassword } from './passwordValidation';

/**
 * Password reset request document in Firestore
 */
export interface PasswordResetRequest {
  emailLower: string;
  codeHash: string;
  salt: string;
  createdAt: admin.firestore.Timestamp;
  expiresAt: admin.firestore.Timestamp;
  resendAvailableAt: admin.firestore.Timestamp;
  sendCountWindowStart: admin.firestore.Timestamp;
  sendCountInWindow: number;
  verifyAttempts: number;
  verifiedAt: admin.firestore.Timestamp | null;
  consumedAt: admin.firestore.Timestamp | null;
}

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const RESET_TOKEN_EXPIRY_MINUTES = 15;

const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY || 'change-me-in-production';

/**
 * Generates a secure 6-digit OTP
 */
function generateOTP(): string {
  // Generate cryptographically secure random number
  const randomBytes = crypto.randomBytes(3); // 3 bytes = 24 bits, enough for 6 digits
  const randomNum = randomBytes.readUIntBE(0, 3);
  // Convert to 6-digit string (000000-999999)
  return String(randomNum % 1000000).padStart(6, '0');
}

/**
 * Generates a random salt for hashing
 */
function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hashes an OTP code with a salt using SHA-256
 */
function hashOTP(code: string, salt: string): string {
  return crypto.createHash('sha256').update(code + salt).digest('hex');
}

/**
 * Constant-time comparison of two strings to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Normalizes email (trim, lowercase)
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Checks if a user exists in Firebase Auth by email
 */
async function userExistsByEmail(email: string): Promise<boolean> {
  try {
    await admin.auth().getUserByEmail(email);
    return true;
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Request a password reset OTP
 * Returns success even if user doesn't exist (prevent enumeration)
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const emailLower = normalizeEmail(email);

  if (!emailLower || !emailLower.includes('@')) {
    throw new Error('Invalid email address');
  }

  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    now.toMillis() + OTP_EXPIRY_MINUTES * 60 * 1000
  );
  const resendAvailableAt = admin.firestore.Timestamp.fromMillis(
    now.toMillis() + RESEND_COOLDOWN_SECONDS * 1000
  );
  const oneHourAgo = admin.firestore.Timestamp.fromMillis(
    now.toMillis() - 60 * 60 * 1000
  );

  // Find existing non-consumed reset requests for this email
  // Note: Firestore doesn't support querying for null directly, so we get all and filter
  // Also avoiding orderBy to prevent needing a composite index - we'll sort in memory
  const existingQuery = await firestore
    .collection('passwordResets')
    .where('emailLower', '==', emailLower)
    .get();

  // Filter for non-consumed requests and sort by createdAt descending
  const nonConsumedDocs = existingQuery.docs
    .filter(doc => {
      const data = doc.data() as PasswordResetRequest;
      return data.consumedAt === null || data.consumedAt === undefined;
    })
    .sort((a, b) => {
      const aData = a.data() as PasswordResetRequest;
      const bData = b.data() as PasswordResetRequest;
      return bData.createdAt.toMillis() - aData.createdAt.toMillis();
    });

  const existingDoc = nonConsumedDocs.length > 0 ? nonConsumedDocs[0] : null;

  if (existingDoc) {
    const existing = existingDoc.data() as PasswordResetRequest;

    // Check resend cooldown
    if (existing.resendAvailableAt.toMillis() > now.toMillis()) {
      const secondsRemaining = Math.ceil(
        (existing.resendAvailableAt.toMillis() - now.toMillis()) / 1000
      );
      throw new Error(`too_many_requests: Please wait ${secondsRemaining} seconds before requesting another code.`);
    }

    // Check send count in the last hour
    const windowStart = existing.sendCountWindowStart.toMillis();
    if (windowStart > oneHourAgo.toMillis()) {
      // Still in the same window
      if (existing.sendCountInWindow >= MAX_SENDS_PER_HOUR) {
        throw new Error('too_many_requests: Maximum number of requests exceeded. Please try again later.');
      }
    }
  }

  // Check if user exists (but don't reveal if they don't)
  const userExists = await userExistsByEmail(emailLower);

  // Generate OTP and hash
  const otp = generateOTP();
  const salt = generateSalt();
  const codeHash = hashOTP(otp, salt);

  // Calculate send count window
  let sendCountWindowStart: admin.firestore.Timestamp;
  let sendCountInWindow: number;

  if (existingDoc) {
    const existing = existingDoc.data() as PasswordResetRequest;
    const windowStart = existing.sendCountWindowStart.toMillis();
    if (windowStart > oneHourAgo.toMillis()) {
      // Same window
      sendCountWindowStart = existing.sendCountWindowStart;
      sendCountInWindow = existing.sendCountInWindow + 1;
    } else {
      // New window
      sendCountWindowStart = now;
      sendCountInWindow = 1;
    }
  } else {
    sendCountWindowStart = now;
    sendCountInWindow = 1;
  }

  // Create or update reset request
  const resetData: Omit<PasswordResetRequest, 'verifiedAt' | 'consumedAt'> & {
    verifiedAt: null;
    consumedAt: null;
  } = {
    emailLower,
    codeHash,
    salt,
    createdAt: now,
    expiresAt,
    resendAvailableAt,
    sendCountWindowStart,
    sendCountInWindow,
    verifyAttempts: 0,
    verifiedAt: null,
    consumedAt: null,
  };

  if (existingDoc) {
    await existingDoc.ref.update(resetData);
  } else {
    await firestore.collection('passwordResets').add(resetData);
  }

  // Send email only if user exists (but don't reveal this)
  if (userExists) {
    try {
      await sendPasswordResetOTP(emailLower, otp);
    } catch (error) {
      console.error('[passwordReset] Failed to send email:', error);
      // Don't throw - we've already saved the request, and we want to return success
      // to prevent enumeration
    }
  }

  // Always return success (prevent enumeration)
}

/**
 * Verify OTP and generate reset token
 */
export async function verifyPasswordResetOTP(
  email: string,
  code: string
): Promise<{ resetToken: string }> {
  const emailLower = normalizeEmail(email);

  if (!code || code.length !== OTP_LENGTH || !/^\d+$/.test(code)) {
    throw new Error('invalid_code');
  }

  const now = admin.firestore.Timestamp.now();

  // Find latest non-consumed reset request
  // Note: Firestore doesn't support querying for null directly, so we get all and filter
  // Also avoiding orderBy to prevent needing a composite index
  const query = await firestore
    .collection('passwordResets')
    .where('emailLower', '==', emailLower)
    .get();

  // Filter for non-consumed requests and sort by createdAt descending
  const nonConsumedDocs = query.docs
    .filter(d => {
      const data = d.data() as PasswordResetRequest;
      return data.consumedAt === null || data.consumedAt === undefined;
    })
    .sort((a, b) => {
      const aData = a.data() as PasswordResetRequest;
      const bData = b.data() as PasswordResetRequest;
      return bData.createdAt.toMillis() - aData.createdAt.toMillis();
    });

  if (nonConsumedDocs.length === 0) {
    throw new Error('invalid_code');
  }

  const doc = nonConsumedDocs[0];

  if (!doc) {
    throw new Error('invalid_code');
  }

  const resetRequest = doc.data() as PasswordResetRequest;

  // Check expiration
  if (resetRequest.expiresAt.toMillis() <= now.toMillis()) {
    throw new Error('expired_code');
  }

  // Check verify attempts
  if (resetRequest.verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
    throw new Error('too_many_attempts');
  }

  // Verify code
  const providedHash = hashOTP(code, resetRequest.salt);
  const isValid = constantTimeCompare(providedHash, resetRequest.codeHash);

  if (!isValid) {
    // Increment verify attempts
    await doc.ref.update({
      verifyAttempts: admin.firestore.FieldValue.increment(1),
    });
    throw new Error('invalid_code');
  }

  // Code is valid - mark as verified and generate reset token
  const tokenId = crypto.randomBytes(16).toString('hex');
  const resetToken = jwt.sign(
    {
      email: emailLower,
      resetRequestId: doc.id,
      tokenId,
      type: 'password-reset',
    },
    JWT_SECRET,
    {
      expiresIn: `${RESET_TOKEN_EXPIRY_MINUTES}m`,
    }
  );

  await doc.ref.update({
    verifiedAt: now,
  });

  return { resetToken };
}

/**
 * Confirm password reset with reset token
 */
export async function confirmPasswordReset(
  resetToken: string,
  newPassword: string
): Promise<void> {
  // Verify JWT first to get email for validation
  let decoded: any;
  try {
    decoded = jwt.verify(resetToken, JWT_SECRET);
    if (decoded.type !== 'password-reset') {
      throw new Error('Invalid token type');
    }
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('expired_token');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('invalid_token');
    }
    throw new Error('invalid_token');
  }

  const { email, resetRequestId, tokenId } = decoded;

  // Validate password strength (with email for additional checks)
  const validation = validatePassword(newPassword, email);
  if (!validation.ok) {
    const error = new Error(validation.code || 'PASSWORD_POLICY_VIOLATION') as any;
    error.validationCode = validation.code;
    error.validationDetails = validation.details;
    throw error;
  }

  // Find reset request
  const resetRequestDoc = await firestore
    .collection('passwordResets')
    .doc(resetRequestId)
    .get();

  if (!resetRequestDoc.exists) {
    throw new Error('invalid_token');
  }

  const resetRequest = resetRequestDoc.data() as PasswordResetRequest;

  // Verify email matches
  if (resetRequest.emailLower !== email) {
    throw new Error('invalid_token');
  }

  // Check if already consumed
  if (resetRequest.consumedAt !== null && resetRequest.consumedAt !== undefined) {
    throw new Error('token_already_used');
  }

  // Check if verified
  if (resetRequest.verifiedAt === null || resetRequest.verifiedAt === undefined) {
    throw new Error('token_not_verified');
  }

  // Update password in Firebase Auth
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, {
      password: newPassword,
    });
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      throw new Error('user_not_found');
    }
    console.error('[passwordReset] Failed to update password:', error);
    throw new Error('Failed to update password');
  }

  // Mark reset request as consumed
  await resetRequestDoc.ref.update({
    consumedAt: admin.firestore.Timestamp.now(),
  });
}

