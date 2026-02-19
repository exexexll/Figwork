/**
 * DocuSign Service — Production-Ready
 *
 * Handles e-signature operations for legal documents:
 * - JWT authentication with DocuSign
 * - Envelope creation (send documents for signing)
 * - Embedded signing (in-app signing ceremony)
 * - Envelope status polling
 * - Webhook (Connect) event verification
 * - Template-based sending
 *
 * CONFIGURATION:
 *   DOCUSIGN_INTEGRATION_KEY   — OAuth integration key (client ID)
 *   DOCUSIGN_USER_ID           — Impersonated user ID (GUID)
 *   DOCUSIGN_ACCOUNT_ID        — DocuSign account ID
 *   DOCUSIGN_PRIVATE_KEY       — RSA private key (PEM, base64-encoded in env)
 *   DOCUSIGN_BASE_URL          — https://demo.docusign.net (dev) or https://na4.docusign.net (prod)
 *   DOCUSIGN_OAUTH_URL         — https://account-d.docusign.com (dev) or https://account.docusign.com (prod)
 *   DOCUSIGN_WEBHOOK_SECRET    — HMAC secret for Connect webhook verification
 *   FRONTEND_URL               — For redirect URLs after signing
 */

import crypto from 'crypto';

// ─── Configuration ──────────────────────────────────────────────────

interface DocuSignConfig {
  integrationKey: string;
  userId: string;
  accountId: string;
  privateKey: string;
  baseUrl: string;
  oauthUrl: string;
  webhookSecret?: string;
}

function getConfig(): DocuSignConfig | null {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const privateKeyBase64 = process.env.DOCUSIGN_PRIVATE_KEY;

  if (!integrationKey || !userId || !accountId || !privateKeyBase64) {
    return null;
  }

  // Private key is stored base64-encoded to avoid newline issues in env vars
  let privateKey: string;
  try {
    privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
  } catch {
    privateKey = privateKeyBase64; // Try raw PEM as fallback
  }

  return {
    integrationKey,
    userId,
    accountId,
    privateKey,
    baseUrl: process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net',
    oauthUrl: process.env.DOCUSIGN_OAUTH_URL || 'https://account-d.docusign.com',
    webhookSecret: process.env.DOCUSIGN_WEBHOOK_SECRET,
  };
}

export function isDocuSignConfigured(): boolean {
  return getConfig() !== null;
}

// ─── JWT Access Token ───────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error('DocuSign not configured');

  // Reuse token if still valid (with 5-min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    iss: config.integrationKey,
    sub: config.userId,
    aud: config.oauthUrl.replace('https://', ''),
    iat: now,
    exp: now + 3600, // 1 hour
    scope: 'signature impersonation',
  };

  // Build JWT manually (no dependency needed)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
  const signInput = `${header}.${payload}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signInput);
  const signature = sign.sign(config.privateKey, 'base64url');
  const jwt = `${signInput}.${signature}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch(`${config.oauthUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`DocuSign JWT auth failed: ${tokenResponse.status} ${errorText}`);
  }

  const tokenData = (await tokenResponse.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    token: tokenData.access_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
  };

  console.log('[DocuSign] JWT access token obtained');
  return cachedToken.token;
}

// ─── API Helper ─────────────────────────────────────────────────────

async function docuSignFetch(
  path: string,
  options: { method?: string; body?: any } = {}
): Promise<any> {
  const config = getConfig();
  if (!config) throw new Error('DocuSign not configured');

  const accessToken = await getAccessToken();
  const url = `${config.baseUrl}/restapi/v2.1/accounts/${config.accountId}${path}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(options.body && { body: JSON.stringify(options.body) }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DocuSign API error ${response.status}: ${errorText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ====================================================================
// ENVELOPE OPERATIONS
// ====================================================================

export interface CreateEnvelopeOptions {
  /** Subject line for the envelope email */
  emailSubject: string;
  /** Email body text */
  emailBody?: string;
  /** List of signers */
  signers: Array<{
    email: string;
    name: string;
    recipientId: string;
    routingOrder?: string;
    /** Tabs (signature fields) to place on the document */
    tabs?: {
      signHereTabs?: Array<{
        anchorString?: string;
        anchorXOffset?: string;
        anchorYOffset?: string;
        documentId?: string;
        pageNumber?: string;
        xPosition?: string;
        yPosition?: string;
      }>;
      dateSignedTabs?: Array<{
        anchorString?: string;
        anchorXOffset?: string;
        anchorYOffset?: string;
        documentId?: string;
        pageNumber?: string;
        xPosition?: string;
        yPosition?: string;
      }>;
      fullNameTabs?: Array<{
        anchorString?: string;
        anchorXOffset?: string;
        anchorYOffset?: string;
        documentId?: string;
        pageNumber?: string;
        xPosition?: string;
        yPosition?: string;
      }>;
    };
  }>;
  /** Documents to include */
  documents: Array<{
    documentId: string;
    name: string;
    /** Base64-encoded document content */
    documentBase64: string;
    fileExtension: string;
  }>;
  /** 'sent' to send immediately, 'created' for draft */
  status?: 'sent' | 'created';
  /** Metadata to attach */
  customFields?: Record<string, string>;
}

export interface EnvelopeResult {
  envelopeId: string;
  status: string;
  statusDateTime: string;
}

/**
 * Create and optionally send an envelope with documents for signing.
 */
export async function createEnvelope(options: CreateEnvelopeOptions): Promise<EnvelopeResult> {
  const config = getConfig();

  if (!config) {
    // Mock mode
    const mockId = `mock_env_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[DocuSign Mock] Created envelope ${mockId} for ${options.signers.map(s => s.email).join(', ')}`);
    return {
      envelopeId: mockId,
      status: options.status || 'sent',
      statusDateTime: new Date().toISOString(),
    };
  }

  const body: any = {
    emailSubject: options.emailSubject,
    emailBlurb: options.emailBody || '',
    documents: options.documents.map((doc) => ({
      documentId: doc.documentId,
      name: doc.name,
      documentBase64: doc.documentBase64,
      fileExtension: doc.fileExtension,
    })),
    recipients: {
      signers: options.signers.map((signer) => ({
        email: signer.email,
        name: signer.name,
        recipientId: signer.recipientId,
        routingOrder: signer.routingOrder || '1',
        tabs: signer.tabs || {},
      })),
    },
    status: options.status || 'sent',
  };

  if (options.customFields) {
    body.customFields = {
      textCustomFields: Object.entries(options.customFields).map(([name, value]) => ({
        name,
        value,
        show: 'false',
      })),
    };
  }

  const result = await docuSignFetch('/envelopes', { method: 'POST', body });

  return {
    envelopeId: result.envelopeId,
    status: result.status,
    statusDateTime: result.statusDateTime,
  };
}

// ====================================================================
// ENVELOPE FROM TEMPLATE
// ====================================================================

export interface CreateFromTemplateOptions {
  /** DocuSign template ID */
  templateId: string;
  /** Subject line */
  emailSubject: string;
  /** Signer role assignments */
  templateRoles: Array<{
    email: string;
    name: string;
    roleName: string; // Must match the role defined in the template
  }>;
  status?: 'sent' | 'created';
  customFields?: Record<string, string>;
}

/**
 * Create an envelope from a pre-built DocuSign template.
 * Templates are configured in the DocuSign admin console with
 * placeholder roles (e.g. "Contractor", "Company Representative").
 */
export async function createEnvelopeFromTemplate(
  options: CreateFromTemplateOptions
): Promise<EnvelopeResult> {
  const config = getConfig();

  if (!config) {
    const mockId = `mock_env_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[DocuSign Mock] Created envelope from template ${options.templateId} -> ${mockId}`);
    return {
      envelopeId: mockId,
      status: options.status || 'sent',
      statusDateTime: new Date().toISOString(),
    };
  }

  const body: any = {
    templateId: options.templateId,
    emailSubject: options.emailSubject,
    templateRoles: options.templateRoles,
    status: options.status || 'sent',
  };

  if (options.customFields) {
    body.customFields = {
      textCustomFields: Object.entries(options.customFields).map(([name, value]) => ({
        name,
        value,
        show: 'false',
      })),
    };
  }

  const result = await docuSignFetch('/envelopes', { method: 'POST', body });

  return {
    envelopeId: result.envelopeId,
    status: result.status,
    statusDateTime: result.statusDateTime,
  };
}

// ====================================================================
// EMBEDDED SIGNING (In-App Signing Ceremony)
// ====================================================================

/**
 * Generate a signing URL for an embedded (in-app) signer.
 * The user is redirected to this URL and signs inside an iframe or redirect.
 */
export async function getEmbeddedSigningUrl(data: {
  envelopeId: string;
  signerEmail: string;
  signerName: string;
  signerClientId: string; // Must match clientUserId set during envelope creation
  returnUrl: string;
}): Promise<{ signingUrl: string }> {
  const config = getConfig();

  if (!config) {
    const mockUrl = `https://demo.docusign.net/mock/signing/${data.envelopeId}?return=${encodeURIComponent(data.returnUrl)}`;
    console.log(`[DocuSign Mock] Embedded signing URL: ${mockUrl}`);
    return { signingUrl: mockUrl };
  }

  const result = await docuSignFetch(`/envelopes/${data.envelopeId}/views/recipient`, {
    method: 'POST',
    body: {
      authenticationMethod: 'none',
      email: data.signerEmail,
      userName: data.signerName,
      clientUserId: data.signerClientId,
      returnUrl: data.returnUrl,
    },
  });

  return { signingUrl: result.url };
}

// ====================================================================
// ENVELOPE STATUS
// ====================================================================

export interface EnvelopeStatus {
  envelopeId: string;
  status: string; // 'sent' | 'delivered' | 'completed' | 'declined' | 'voided'
  sentDateTime?: string;
  completedDateTime?: string;
  declinedDateTime?: string;
  voidedDateTime?: string;
  recipients?: Array<{
    email: string;
    name: string;
    status: string; // 'sent' | 'delivered' | 'completed' | 'declined'
    signedDateTime?: string;
    declinedDateTime?: string;
    declinedReason?: string;
  }>;
}

export async function getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
  const config = getConfig();

  if (!config) {
    return {
      envelopeId,
      status: 'completed',
      completedDateTime: new Date().toISOString(),
    };
  }

  const result = await docuSignFetch(`/envelopes/${envelopeId}`);

  return {
    envelopeId: result.envelopeId,
    status: result.status,
    sentDateTime: result.sentDateTime,
    completedDateTime: result.completedDateTime,
    declinedDateTime: result.declinedDateTime,
    voidedDateTime: result.voidedDateTime,
  };
}

export async function getEnvelopeRecipients(envelopeId: string): Promise<EnvelopeStatus['recipients']> {
  const config = getConfig();

  if (!config) {
    return [
      {
        email: 'mock@example.com',
        name: 'Mock Signer',
        status: 'completed',
        signedDateTime: new Date().toISOString(),
      },
    ];
  }

  const result = await docuSignFetch(`/envelopes/${envelopeId}/recipients`);
  const signers = result.signers || [];

  return signers.map((s: any) => ({
    email: s.email,
    name: s.name,
    status: s.status,
    signedDateTime: s.signedDateTime,
    declinedDateTime: s.declinedDateTime,
    declinedReason: s.declinedReason,
  }));
}

// ====================================================================
// VOID ENVELOPE
// ====================================================================

export async function voidEnvelope(
  envelopeId: string,
  reason: string
): Promise<void> {
  const config = getConfig();

  if (!config) {
    console.log(`[DocuSign Mock] Voided envelope ${envelopeId}: ${reason}`);
    return;
  }

  await docuSignFetch(`/envelopes/${envelopeId}`, {
    method: 'PUT',
    body: {
      status: 'voided',
      voidedReason: reason,
    },
  });
}

// ====================================================================
// DOWNLOAD SIGNED DOCUMENT
// ====================================================================

export async function downloadSignedDocument(
  envelopeId: string,
  documentId: string = 'combined'
): Promise<Buffer> {
  const config = getConfig();

  if (!config) {
    // Return a minimal mock PDF
    return Buffer.from('%PDF-1.4 mock signed document', 'utf8');
  }

  const accessToken = await getAccessToken();
  const url = `${config.baseUrl}/restapi/v2.1/accounts/${config.accountId}/envelopes/${envelopeId}/documents/${documentId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download document: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ====================================================================
// WEBHOOK VERIFICATION
// ====================================================================

/**
 * Verify a DocuSign Connect (webhook) HMAC signature.
 * DocuSign sends X-DocuSign-Signature-1 header with HMAC-SHA256 of the body.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret?: string
): boolean {
  const webhookSecret = secret || process.env.DOCUSIGN_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn('[DocuSign] No webhook secret configured — skipping verification');
    return true; // Allow in dev
  }

  const body = typeof payload === 'string' ? payload : payload.toString('utf8');
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(body);
  const computed = hmac.digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(computed, 'base64')
    );
  } catch {
    return false;
  }
}

// ====================================================================
// CONVENIENCE: Send Contractor Agreement
// ====================================================================

/**
 * Send a contractor agreement for signing.
 * Uses a template if DOCUSIGN_CONTRACTOR_TEMPLATE_ID is set,
 * otherwise creates an envelope with inline document content.
 */
export async function sendContractorAgreement(data: {
  studentId: string;
  studentName: string;
  studentEmail: string;
  /** HTML or base64 PDF content of the agreement */
  agreementContent: string;
  agreementName: string;
  agreementVersion: string;
  /** If using embedded signing, pass a clientUserId */
  clientUserId?: string;
}): Promise<{ envelopeId: string; signingUrl?: string }> {
  const templateId = process.env.DOCUSIGN_CONTRACTOR_TEMPLATE_ID;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  let envelopeResult: EnvelopeResult;

  if (templateId) {
    // Use pre-built template
    envelopeResult = await createEnvelopeFromTemplate({
      templateId,
      emailSubject: `Figwork: Please sign your ${data.agreementName}`,
      templateRoles: [
        {
          email: data.studentEmail,
          name: data.studentName,
          roleName: 'Contractor',
        },
      ],
      customFields: {
        studentId: data.studentId,
        agreementVersion: data.agreementVersion,
      },
    });
  } else {
    // Create envelope with inline content
    const documentBase64 = Buffer.from(data.agreementContent).toString('base64');

    envelopeResult = await createEnvelope({
      emailSubject: `Figwork: Please sign your ${data.agreementName}`,
      emailBody: `Hi ${data.studentName}, please review and sign the attached ${data.agreementName} to continue working on Figwork.`,
      signers: [
        {
          email: data.studentEmail,
          name: data.studentName,
          recipientId: '1',
          tabs: {
            signHereTabs: [
              { anchorString: '/sig1/', anchorXOffset: '0', anchorYOffset: '0' },
            ],
            dateSignedTabs: [
              { anchorString: '/date1/', anchorXOffset: '0', anchorYOffset: '0' },
            ],
            fullNameTabs: [
              { anchorString: '/name1/', anchorXOffset: '0', anchorYOffset: '0' },
            ],
          },
        },
      ],
      documents: [
        {
          documentId: '1',
          name: data.agreementName,
          documentBase64,
          fileExtension: 'html',
        },
      ],
      status: 'sent',
      customFields: {
        studentId: data.studentId,
        agreementVersion: data.agreementVersion,
        platform: 'figwork',
      },
    });
  }

  // Generate embedded signing URL if clientUserId is provided
  let signingUrl: string | undefined;
  if (data.clientUserId) {
    const embedded = await getEmbeddedSigningUrl({
      envelopeId: envelopeResult.envelopeId,
      signerEmail: data.studentEmail,
      signerName: data.studentName,
      signerClientId: data.clientUserId,
      returnUrl: `${frontendUrl}/student/onboard?step=contract&status=signed&envelopeId=${envelopeResult.envelopeId}`,
    });
    signingUrl = embedded.signingUrl;
  }

  return {
    envelopeId: envelopeResult.envelopeId,
    signingUrl,
  };
}
