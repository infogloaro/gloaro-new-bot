import { FieldType } from './flow-definition';

export type { FieldType };

export interface ValidationResult {
  valid: boolean;
  /** Cleaned value to store when valid. */
  value?: string;
  /** Customer-facing message explaining what to send instead. */
  error?: string;
}

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]{1,79}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const PINCODE_RE = /^\d{6}$/;
const ORDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-_/]{3,39}$/;

/**
 * Normalises an Indian mobile number to digits only.
 * Accepts +91 98765 43210, 09876543210, 9876543210, 919876543210.
 * Returns null when it is not a plausible mobile number.
 */
export function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/[^\d]/g, '');

  // Strip a leading 0 (STD prefix) or 91 country code to get the 10-digit core.
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 13 && digits.startsWith('091')) digits = digits.slice(3);

  // Indian mobile numbers are 10 digits and start 6-9.
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;

  // Allow other international numbers of a sane length rather than rejecting
  // a legitimate overseas enquiry.
  if (digits.length >= 10 && digits.length <= 15) return digits;

  return null;
}

/** Formats a stored digits-only number back for display, e.g. +91 98765 43210. */
export function formatPhone(digits: string): string {
  if (digits.length === 12 && digits.startsWith('91')) {
    const core = digits.slice(2);
    return `+91 ${core.slice(0, 5)} ${core.slice(5)}`;
  }
  return `+${digits}`;
}

export function validateField(type: FieldType, raw: string): ValidationResult {
  const value = raw.trim().replace(/\s+/g, ' ');

  if (!value) {
    return { valid: false, error: 'That looks empty. Please type your answer.' };
  }

  switch (type) {
    case 'name':
      if (!NAME_RE.test(value)) {
        return {
          valid: false,
          error: 'Please share a valid name using letters only (2–80 characters).',
        };
      }
      return { valid: true, value };

    case 'email':
      if (!EMAIL_RE.test(value)) {
        return {
          valid: false,
          error: 'That does not look like a valid email. Example: name@company.com',
        };
      }
      return { valid: true, value: value.toLowerCase() };

    case 'phone': {
      const phone = normalisePhone(value);
      if (!phone) {
        return {
          valid: false,
          error: 'Please share a valid 10-digit mobile number. Example: 9876543210',
        };
      }
      return { valid: true, value: phone };
    }

    case 'city':
      // Chapters accepts either a city name or a 6-digit PIN code.
      if (PINCODE_RE.test(value)) return { valid: true, value };
      if (!NAME_RE.test(value)) {
        return { valid: false, error: 'Please share a valid city name or a 6-digit PIN code.' };
      }
      return { valid: true, value };

    case 'pincode':
      if (!PINCODE_RE.test(value)) {
        return { valid: false, error: 'Please share a valid 6-digit PIN code. Example: 600001' };
      }
      return { valid: true, value };

    case 'orderid':
      if (!ORDER_ID_RE.test(value)) {
        return {
          valid: false,
          error: 'Please share a valid Order ID as it appears in your order confirmation.',
        };
      }
      return { valid: true, value: value.toUpperCase() };

    case 'longtext':
      if (value.length < 3) {
        return { valid: false, error: 'Please share a little more detail (at least 3 characters).' };
      }
      if (value.length > 2000) {
        return { valid: false, error: 'That message is too long. Please keep it under 2000 characters.' };
      }
      return { valid: true, value };

    case 'text':
    default:
      if (value.length < 2) {
        return { valid: false, error: 'Please share a little more detail (at least 2 characters).' };
      }
      if (value.length > 200) {
        return { valid: false, error: 'Please keep your answer under 200 characters.' };
      }
      return { valid: true, value };
  }
}
