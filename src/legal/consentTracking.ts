/**
 * Consent tracking for legal documents
 */

import { firestore } from '../config/firestore';
import { PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION } from './documents';

export interface ConsentRecord {
  acceptedPrivacyPolicyVersion: string | null;
  acceptedTermsVersion: string | null;
  acceptedAt: string | null;
}

/**
 * Record user consent for legal documents
 * Called during signup or when documents are updated
 */
export async function recordConsent(
  userId: string,
  privacyPolicyVersion: string = PRIVACY_POLICY_VERSION,
  termsVersion: string = TERMS_OF_SERVICE_VERSION
): Promise<void> {
  const consentData: ConsentRecord = {
    acceptedPrivacyPolicyVersion: privacyPolicyVersion,
    acceptedTermsVersion: termsVersion,
    acceptedAt: new Date().toISOString(),
  };

  await firestore.collection('users').doc(userId).set(
    {
      ...consentData,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

/**
 * Get user's consent record
 */
export async function getConsentRecord(userId: string): Promise<ConsentRecord | null> {
  const doc = await firestore.collection('users').doc(userId).get();
  if (!doc.exists) return null;

  const data = doc.data();
  if (!data) return null;

  return {
    acceptedPrivacyPolicyVersion: data.acceptedPrivacyPolicyVersion ?? null,
    acceptedTermsVersion: data.acceptedTermsVersion ?? null,
    acceptedAt: data.acceptedAt ?? null,
  };
}

/**
 * Check if user needs to re-accept documents (if versions have changed)
 */
export async function needsConsentUpdate(userId: string): Promise<boolean> {
  const consent = await getConsentRecord(userId);
  if (!consent) return true; // New user, needs consent

  return (
    consent.acceptedPrivacyPolicyVersion !== PRIVACY_POLICY_VERSION ||
    consent.acceptedTermsVersion !== TERMS_OF_SERVICE_VERSION
  );
}

