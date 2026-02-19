/**
 * Twilio Service — Production-Ready
 *
 * Handles SMS and voice operations:
 * - Direct SMS sending (POW alerts, task notifications, deadlines)
 * - Twilio Verify (phone number verification with OTP)
 * - Phone number lookup/validation
 * - Formatted message templates
 *
 * CONFIGURATION:
 *   TWILIO_ACCOUNT_SID         — Twilio Account SID (ACxxxxxxx)
 *   TWILIO_AUTH_TOKEN           — Twilio Auth Token
 *   TWILIO_PHONE_NUMBER         — Sender phone number (+1xxxxxxxxxx)
 *   TWILIO_VERIFY_SERVICE_SID   — Verify Service SID (VAxxxxxxx) for OTP
 *   TWILIO_MESSAGING_SERVICE_SID — Messaging Service SID (optional, for high-throughput)
 *   FRONTEND_URL               — For deep links in SMS messages
 */

// ─── Types ───────────────────────────────────────────────────────────

type TwilioClient = {
  messages: {
    create: (options: {
      body: string;
      to: string;
      from?: string;
      messagingServiceSid?: string;
    }) => Promise<{ sid: string; status: string }>;
  };
  verify: {
    v2: {
      services: (sid: string) => {
        verifications: {
          create: (options: { to: string; channel: string }) => Promise<{ sid: string; status: string }>;
        };
        verificationChecks: {
          create: (options: { to: string; code: string }) => Promise<{ status: string; valid: boolean }>;
        };
      };
    };
  };
  lookups: {
    v2: {
      phoneNumbers: (number: string) => {
        fetch: (options?: { fields?: string }) => Promise<{
          phoneNumber: string;
          valid: boolean;
          callingCountryCode: string;
          nationalFormat: string;
          countryCode: string;
          lineTypeIntelligence?: { type: string };
        }>;
      };
    };
  };
};

// ─── Client Initialization ──────────────────────────────────────────

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

let twilioClient: TwilioClient | null = null;

async function getTwilioClient(): Promise<TwilioClient | null> {
  if (twilioClient) return twilioClient;

  if (!accountSid || !authToken) {
    console.warn('[Twilio] Not configured — SMS will be logged only');
    return null;
  }

  try {
    // @ts-ignore — twilio may not be installed
    const twilioModule = await import('twilio').catch(() => null);
    if (!twilioModule) {
      console.warn('[Twilio] Module not available — SMS will be logged only');
      return null;
    }
    const twilio = twilioModule.default;
    twilioClient = twilio(accountSid, authToken) as unknown as TwilioClient;
    console.log('[Twilio] Client initialized');
    return twilioClient;
  } catch (e) {
    console.warn('[Twilio] Initialization failed — SMS will be logged only');
    return null;
  }
}

export function isTwilioConfigured(): boolean {
  return !!(accountSid && authToken && fromNumber);
}

// ====================================================================
// SMS SENDING
// ====================================================================

export interface SendSMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendSMS(
  to: string,
  body: string
): Promise<SendSMSResult> {
  const client = await getTwilioClient();

  if (!client || !fromNumber) {
    console.log(`[Twilio Mock] SMS to ${to}: ${body}`);
    return { success: true, messageId: `mock_sms_${Date.now()}` };
  }

  try {
    const message = await client.messages.create({
      body,
      to: formatPhoneNumber(to),
      ...(messagingServiceSid
        ? { messagingServiceSid }
        : { from: fromNumber }),
    });

    return {
      success: true,
      messageId: message.sid,
    };
  } catch (error: any) {
    console.error('[Twilio] SMS send failed:', error.message);
    return {
      success: false,
      error: error.message || 'Failed to send SMS',
    };
  }
}

// ====================================================================
// POW NOTIFICATIONS
// ====================================================================

export async function sendPOWRequest(
  phone: string,
  data: {
    studentName: string;
    taskTitle: string;
    timeoutMinutes: number;
    powUrl: string;
  }
): Promise<SendSMSResult> {
  const body = `📸 Figwork POW Request: Hi ${data.studentName}, please submit proof of work for "${data.taskTitle}" within ${data.timeoutMinutes} mins.\n\nTap here: ${data.powUrl}`;
  return sendSMS(phone, body);
}

export async function sendPOWReminder(
  phone: string,
  data: {
    studentName: string;
    taskTitle: string;
    remainingMinutes: number;
    powUrl: string;
  }
): Promise<SendSMSResult> {
  const body = `⚠️ Figwork URGENT: ${data.studentName}, only ${data.remainingMinutes} mins left for POW on "${data.taskTitle}".\n\nSubmit now: ${data.powUrl}`;
  return sendSMS(phone, body);
}

export async function sendPOWExpired(
  phone: string,
  data: {
    studentName: string;
    taskTitle: string;
  }
): Promise<SendSMSResult> {
  const body = `❌ Figwork: POW request expired for "${data.taskTitle}". This may affect your quality score. Contact support if you had issues.`;
  return sendSMS(phone, body);
}

// ====================================================================
// TASK NOTIFICATIONS
// ====================================================================

export async function sendTaskAssigned(
  phone: string,
  data: {
    studentName: string;
    taskTitle: string;
    deadlineHours: number;
    dashboardUrl: string;
  }
): Promise<SendSMSResult> {
  const body = `✅ Figwork: New task assigned! "${data.taskTitle}" — Due in ${data.deadlineHours}hrs.\n\nView details: ${data.dashboardUrl}`;
  return sendSMS(phone, body);
}

export async function sendDeadlineWarning(
  phone: string,
  data: {
    taskTitle: string;
    hoursRemaining: number;
  }
): Promise<SendSMSResult> {
  const body = `⏰ Figwork DEADLINE: "${data.taskTitle}" is due in ${data.hoursRemaining} hours. Submit your work soon!`;
  return sendSMS(phone, body);
}

export async function sendRevisionRequired(
  phone: string,
  data: {
    taskTitle: string;
    deadlineHours: number;
    dashboardUrl: string;
  }
): Promise<SendSMSResult> {
  const body = `🔄 Figwork: Revision needed for "${data.taskTitle}". Due in ${data.deadlineHours}hrs.\n\nView feedback: ${data.dashboardUrl}`;
  return sendSMS(phone, body);
}

export async function sendPayoutCompleted(
  phone: string,
  data: { amount: string }
): Promise<SendSMSResult> {
  const body = `💰 Figwork: ${data.amount} has been deposited to your connected account. Thanks for your great work!`;
  return sendSMS(phone, body);
}

export async function sendDisputeUpdate(
  phone: string,
  data: { taskTitle: string; status: string }
): Promise<SendSMSResult> {
  const body = `⚖️ Figwork: Your dispute for "${data.taskTitle}" has been ${data.status}. Check the app for details.`;
  return sendSMS(phone, body);
}

// ====================================================================
// PHONE VERIFICATION (Twilio Verify)
// ====================================================================

export async function startPhoneVerification(phone: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const client = await getTwilioClient();
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!client || !verifyServiceSid) {
    // Mock mode — log and accept
    console.log(`[Twilio Verify Mock] Sending OTP to ${phone} (use code 123456 in dev)`);
    return { success: true };
  }

  try {
    await client.verify.v2
      .services(verifyServiceSid)
      .verifications.create({
        to: formatPhoneNumber(phone),
        channel: 'sms',
      });

    return { success: true };
  } catch (error: any) {
    console.error('[Twilio Verify] Start failed:', error.message);
    return { success: false, error: error.message };
  }
}

export async function checkPhoneVerification(
  phone: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  const client = await getTwilioClient();
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!client || !verifyServiceSid) {
    // Mock mode — accept "123456" in development
    const isValid = code === '123456';
    console.log(`[Twilio Verify Mock] Check ${phone} code=${code} → ${isValid ? 'approved' : 'rejected'}`);
    return { success: isValid };
  }

  try {
    const check = await client.verify.v2
      .services(verifyServiceSid)
      .verificationChecks.create({
        to: formatPhoneNumber(phone),
        code,
      });

    return { success: check.status === 'approved' };
  } catch (error: any) {
    console.error('[Twilio Verify] Check failed:', error.message);
    return { success: false, error: error.message };
  }
}

// ====================================================================
// PHONE NUMBER LOOKUP
// ====================================================================

export interface PhoneLookupResult {
  valid: boolean;
  phoneNumber: string;
  countryCode: string;
  nationalFormat: string;
  lineType?: string;
  error?: string;
}

export async function lookupPhoneNumber(phone: string): Promise<PhoneLookupResult> {
  const client = await getTwilioClient();

  if (!client) {
    const formatted = formatPhoneNumber(phone);
    return {
      valid: formatted.length >= 10,
      phoneNumber: formatted,
      countryCode: 'US',
      nationalFormat: phone,
    };
  }

  try {
    const result = await client.lookups.v2.phoneNumbers(formatPhoneNumber(phone)).fetch({
      fields: 'line_type_intelligence',
    });

    return {
      valid: result.valid,
      phoneNumber: result.phoneNumber,
      countryCode: result.countryCode,
      nationalFormat: result.nationalFormat,
      lineType: result.lineTypeIntelligence?.type,
    };
  } catch (error: any) {
    return {
      valid: false,
      phoneNumber: phone,
      countryCode: '',
      nationalFormat: phone,
      error: error.message,
    };
  }
}

// ====================================================================
// HELPERS
// ====================================================================

function formatPhoneNumber(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // US number (10 digits)
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Already has country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Add + if not present
  if (!phone.startsWith('+')) {
    return `+${digits}`;
  }

  return phone;
}

// ====================================================================
// WEBHOOK VALIDATION
// ====================================================================

import crypto from 'crypto';

/**
 * Validate Twilio webhook request signature.
 * Twilio signs requests with HMAC-SHA1 using your auth token.
 */
export function validateTwilioWebhook(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  if (!authToken) return true; // Skip in dev

  // Build the validation string: URL + sorted params
  const sortedKeys = Object.keys(params).sort();
  let validationStr = url;
  for (const key of sortedKeys) {
    validationStr += key + params[key];
  }

  const computed = crypto
    .createHmac('sha1', authToken)
    .update(validationStr)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computed)
    );
  } catch {
    return false;
  }
}
