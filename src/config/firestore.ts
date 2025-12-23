import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";

if (!admin.apps.length) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'thelongevityapp-b9b7c';
  
  // Try to use service account key file if available
  const serviceAccountPath = path.join(__dirname, '../../secrets/serviceAccountKey.json');
  let credential;
  
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    credential = admin.credential.cert(serviceAccount);
    console.log('[Firestore] Using service account key file');
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Use GOOGLE_APPLICATION_CREDENTIALS env var if set
    credential = admin.credential.applicationDefault();
    console.log('[Firestore] Using GOOGLE_APPLICATION_CREDENTIALS');
  } else {
    // Fallback to applicationDefault (may fail if not configured)
    credential = admin.credential.applicationDefault();
    console.log('[Firestore] Using applicationDefault (may require setup)');
  }
  
  admin.initializeApp({
    credential: credential,
    projectId: projectId,
  });
}

export const firestore = admin.firestore();

/**
 * Converts Firestore data to plain JSON by converting Timestamps to ISO strings
 */
export function firestoreToJSON(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle Firestore Timestamp
  if (data.toDate && typeof data.toDate === 'function') {
    return data.toDate().toISOString();
  }

  // Handle Date objects
  if (data instanceof Date) {
    return data.toISOString();
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => firestoreToJSON(item));
  }

  // Handle objects
  if (typeof data === 'object') {
    const result: any = {};
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        result[key] = firestoreToJSON(data[key]);
      }
    }
    return result;
  }

  // Return primitives as-is
  return data;
}
