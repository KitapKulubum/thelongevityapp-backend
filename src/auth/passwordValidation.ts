/**
 * Password validation helper with human-friendly error codes.
 * Returns error codes that can be mapped to user-friendly messages in the UI.
 */

export interface PasswordValidationResult {
  ok: boolean;
  code?: 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_WEAK' | 'PASSWORD_POLICY_VIOLATION';
  details?: { minLength?: number };
}

/**
 * List of extremely common weak passwords to reject
 */
const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwerty123',
  'abc123',
  '11111111',
  '00000000',
  '123123',
  '12341234',
  'admin',
  'admin123',
  'letmein',
  'welcome',
  'welcome123',
  'monkey',
  'dragon',
  'master',
  'sunshine',
  'princess',
  'football',
  'iloveyou',
  'trustno1',
  'superman',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
]);

/**
 * Validates password strength and returns error code if validation fails.
 * 
 * @param password - The password to validate
 * @param email - Optional email address to check if password contains email username
 * @returns Validation result with error code if invalid
 */
export function validatePassword(
  password: string,
  email?: string | null
): PasswordValidationResult {
  // Check if password is provided
  if (!password || typeof password !== 'string') {
    return {
      ok: false,
      code: 'PASSWORD_TOO_SHORT',
      details: { minLength: 8 },
    };
  }

  const passwordLower = password.toLowerCase().trim();

  // Check minimum length
  if (password.length < 8) {
    return {
      ok: false,
      code: 'PASSWORD_TOO_SHORT',
      details: { minLength: 8 },
    };
  }

  // Check against common weak passwords
  if (COMMON_WEAK_PASSWORDS.has(passwordLower)) {
    return {
      ok: false,
      code: 'PASSWORD_TOO_WEAK',
    };
  }

  // Check for simple patterns (all same character, sequential, etc.)
  if (isSimplePattern(password)) {
    return {
      ok: false,
      code: 'PASSWORD_TOO_WEAK',
    };
  }

  // Optional: Check if password equals email or contains email username
  if (email) {
    const emailLower = email.toLowerCase().trim();
    const emailUsername = emailLower.split('@')[0];
    
    // Reject if password equals email
    if (passwordLower === emailLower) {
      return {
        ok: false,
        code: 'PASSWORD_POLICY_VIOLATION',
      };
    }
    
    // Reject if password contains email username (at least 3 characters)
    if (emailUsername.length >= 3 && passwordLower.includes(emailUsername)) {
      return {
        ok: false,
        code: 'PASSWORD_POLICY_VIOLATION',
      };
    }
  }

  return { ok: true };
}

/**
 * Checks if password follows simple patterns that make it weak.
 * Examples: "aaaaaaaa", "12345678", "abcdefgh", "qwertyui"
 */
function isSimplePattern(password: string): boolean {
  const passwordLower = password.toLowerCase();
  
  // Check for all same character
  if (/^(.)\1+$/.test(passwordLower)) {
    return true;
  }
  
  // Check for sequential numbers (ascending or descending)
  if (/^[0-9]+$/.test(passwordLower)) {
    let isSequential = true;
    for (let i = 1; i < passwordLower.length; i++) {
      const prev = parseInt(passwordLower[i - 1]);
      const curr = parseInt(passwordLower[i]);
      if (curr !== prev + 1 && curr !== prev - 1) {
        isSequential = false;
        break;
      }
    }
    if (isSequential && passwordLower.length >= 4) {
      return true;
    }
  }
  
  // Check for sequential letters (qwerty, abcdef, etc.)
  if (/^[a-z]+$/.test(passwordLower)) {
    let isSequential = true;
    for (let i = 1; i < passwordLower.length; i++) {
      const prev = passwordLower.charCodeAt(i - 1);
      const curr = passwordLower.charCodeAt(i);
      if (curr !== prev + 1 && curr !== prev - 1) {
        isSequential = false;
        break;
      }
    }
    if (isSequential && passwordLower.length >= 4) {
      return true;
    }
  }
  
  // Check for keyboard patterns (qwerty, asdf, etc.)
  const keyboardRows = [
    'qwertyuiop',
    'asdfghjkl',
    'zxcvbnm',
  ];
  
  for (const row of keyboardRows) {
    if (passwordLower.length >= 4 && row.includes(passwordLower)) {
      return true;
    }
    // Check reverse
    if (passwordLower.length >= 4 && row.split('').reverse().join('').includes(passwordLower)) {
      return true;
    }
  }
  
  return false;
}

