import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
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
