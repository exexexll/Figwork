/**
 * Environment Configuration Validator
 *
 * Validates and reports on the configuration status of all external services.
 * Used at startup to log which services are active vs. running in mock mode.
 *
 * Usage:
 *   import { validateEnvironment, logServiceStatus } from './lib/env-config.js';
 *   logServiceStatus(); // Logs a formatted table of service statuses
 */

interface ServiceConfig {
  name: string;
  requiredVars: string[];
  optionalVars?: string[];
  description: string;
}

const SERVICES: ServiceConfig[] = [
  {
    name: 'PostgreSQL',
    requiredVars: ['DATABASE_URL'],
    description: 'Primary database',
  },
  {
    name: 'Redis',
    requiredVars: ['REDIS_URL'],
    description: 'Cache, rate limiting, job queues',
  },
  {
    name: 'Clerk Auth',
    requiredVars: ['CLERK_SECRET_KEY'],
    optionalVars: ['CLERK_PUBLISHABLE_KEY'],
    description: 'Authentication & user management',
  },
  {
    name: 'Stripe Payments',
    requiredVars: ['STRIPE_SECRET_KEY'],
    optionalVars: ['STRIPE_WEBHOOK_SECRET'],
    description: 'Payments, escrow, Connect payouts, Identity KYC',
  },
  {
    name: 'DocuSign',
    requiredVars: ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_USER_ID', 'DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_PRIVATE_KEY'],
    optionalVars: ['DOCUSIGN_WEBHOOK_SECRET', 'DOCUSIGN_CONTRACTOR_TEMPLATE_ID', 'DOCUSIGN_BASE_URL'],
    description: 'E-signature for legal documents',
  },
  {
    name: 'Twilio SMS',
    requiredVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
    optionalVars: ['TWILIO_VERIFY_SERVICE_SID', 'TWILIO_MESSAGING_SERVICE_SID'],
    description: 'SMS notifications, phone verification',
  },
  {
    name: 'Email (Resend)',
    requiredVars: ['RESEND_API_KEY'],
    optionalVars: ['EMAIL_FROM', 'EMAIL_FROM_NAME', 'EMAIL_REPLY_TO'],
    description: 'Transactional emails',
  },
  {
    name: 'Email (SendGrid)',
    requiredVars: ['SENDGRID_API_KEY'],
    optionalVars: ['EMAIL_FROM', 'EMAIL_FROM_NAME'],
    description: 'Transactional emails (fallback)',
  },
  {
    name: 'Cloudinary',
    requiredVars: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
    description: 'File/image storage',
  },
  {
    name: 'OpenAI',
    requiredVars: ['OPENAI_API_KEY'],
    description: 'AI interviews, RAG, quality analysis',
  },
  {
    name: 'ElevenLabs',
    requiredVars: ['ELEVENLABS_API_KEY'],
    optionalVars: ['ELEVENLABS_VOICE_ID'],
    description: 'Text-to-speech for AI interviews',
  },
];

interface ServiceStatus {
  name: string;
  description: string;
  configured: boolean;
  missingRequired: string[];
  missingOptional: string[];
}

export function validateEnvironment(): ServiceStatus[] {
  return SERVICES.map((service) => {
    const missingRequired = service.requiredVars.filter((v) => !process.env[v]);
    const missingOptional = (service.optionalVars || []).filter((v) => !process.env[v]);

    return {
      name: service.name,
      description: service.description,
      configured: missingRequired.length === 0,
      missingRequired,
      missingOptional,
    };
  });
}

export function logServiceStatus(): void {
  const statuses = validateEnvironment();
  const configured = statuses.filter((s) => s.configured);
  const mocked = statuses.filter((s) => !s.configured);

  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│               SERVICE CONFIGURATION STATUS              │');
  console.log('├─────────────────────────────────────────────────────────┤');

  if (configured.length > 0) {
    console.log('│ ✅ CONFIGURED:                                          │');
    for (const s of configured) {
      const line = `│    ${s.name} — ${s.description}`;
      console.log(line.padEnd(58) + '│');
      if (s.missingOptional.length > 0) {
        const optLine = `│       ⚠ Optional: ${s.missingOptional.join(', ')}`;
        console.log(optLine.padEnd(58) + '│');
      }
    }
  }

  if (mocked.length > 0) {
    console.log('│                                                         │');
    console.log('│ 🔶 MOCK MODE (configure to enable):                    │');
    for (const s of mocked) {
      const line = `│    ${s.name} — ${s.description}`;
      console.log(line.padEnd(58) + '│');
      const missingLine = `│       Missing: ${s.missingRequired.join(', ')}`;
      console.log(missingLine.padEnd(58) + '│');
    }
  }

  console.log('└─────────────────────────────────────────────────────────┘\n');
}

/**
 * Required environment variables for the app to start at all.
 * Missing any of these will cause a fatal error at startup.
 */
const CRITICAL_VARS = ['DATABASE_URL'];

export function validateCriticalEnvironment(): void {
  const missing = CRITICAL_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`\n❌ FATAL: Missing critical environment variables: ${missing.join(', ')}`);
    console.error('The application cannot start without these. Please check your .env file.\n');
    process.exit(1);
  }
}
