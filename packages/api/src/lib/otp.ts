// In-memory OTP store for MVP. Replace with Redis in production.
const otpStore = new Map<string, { otp: string; expiresAt: number; attempts: number }>();

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function storeOTP(phone: string, otp: string): void {
  otpStore.set(phone, {
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    attempts: 0,
  });
}

export function verifyOTP(phone: string, otp: string): { valid: boolean; error?: string } {
  const record = otpStore.get(phone);
  if (!record) return { valid: false, error: 'No OTP found. Request a new one.' };
  if (Date.now() > record.expiresAt) {
    otpStore.delete(phone);
    return { valid: false, error: 'OTP expired. Request a new one.' };
  }
  record.attempts++;
  if (record.attempts > 5) {
    otpStore.delete(phone);
    return { valid: false, error: 'Too many attempts. Request a new OTP.' };
  }
  if (record.otp !== otp) return { valid: false, error: 'Invalid OTP.' };
  otpStore.delete(phone);
  return { valid: true };
}

// Rate limiting for OTP sends
const sendLimits = new Map<string, { count: number; blockedUntil: number }>();

export function checkSendLimit(phone: string): { allowed: boolean; error?: string } {
  const record = sendLimits.get(phone);
  if (record && Date.now() < record.blockedUntil) {
    return { allowed: false, error: 'Too many attempts. Please wait 10 minutes.' };
  }
  if (record && record.count >= 3) {
    record.blockedUntil = Date.now() + 10 * 60 * 1000;
    return { allowed: false, error: 'Too many attempts. Please wait 10 minutes.' };
  }
  const current = record || { count: 0, blockedUntil: 0 };
  current.count++;
  sendLimits.set(phone, current);
  // Reset count after 10 minutes
  setTimeout(() => sendLimits.delete(phone), 10 * 60 * 1000);
  return { allowed: true };
}
