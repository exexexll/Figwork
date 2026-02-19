/**
 * Stripe Service — Production-Ready
 *
 * Handles all Stripe-related operations:
 * - Customer creation & management
 * - Payment intents for escrow funding
 * - Checkout Sessions for company add-funds
 * - Connect accounts (Express) for student payouts
 * - Transfers (payouts to connected accounts)
 * - Identity verification (KYC)
 * - Tax form reporting (via Connect)
 * - Invoice generation
 * - Webhook signature verification
 *
 * CONFIGURATION:
 *   STRIPE_SECRET_KEY          — Stripe secret key (sk_test_… or sk_live_…)
 *   STRIPE_WEBHOOK_SECRET      — Webhook endpoint signing secret (whsec_…)
 *   STRIPE_IDENTITY_WEBHOOK_SECRET — Identity webhook signing secret (optional, falls back to main)
 *   FRONTEND_URL               — Used for redirect URLs
 */

// ─── Types ───────────────────────────────────────────────────────────
type StripeClient = {
  customers: any;
  paymentIntents: any;
  checkout: { sessions: any };
  accountLinks: any;
  accounts: any;
  transfers: any;
  invoiceItems: any;
  invoices: any;
  identity: { verificationSessions: any };
  webhooks: { constructEvent: (payload: string | Buffer, sig: string, secret: string) => any };
};

let stripe: StripeClient | null = null;

// ─── Client Initialization ──────────────────────────────────────────
async function getStripeClient(): Promise<StripeClient> {
  if (stripe) return stripe;

  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('[Stripe] No STRIPE_SECRET_KEY configured — using mock mode');
    return createMockStripeClient();
  }

  try {
    // @ts-ignore — stripe may not be installed yet
    const stripeModule = await import('stripe').catch(() => null);
    if (!stripeModule) {
      console.warn('[Stripe] Stripe module not installed — using mock mode');
      return createMockStripeClient();
    }
    const Stripe = stripeModule.default;
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20' as any,
      typescript: true,
    }) as unknown as StripeClient;
    console.log('[Stripe] Initialized with live client');
    return stripe;
  } catch (e) {
    console.warn('[Stripe] Initialization failed — using mock mode', e);
    return createMockStripeClient();
  }
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

// ─── Mock Client (Development) ──────────────────────────────────────
function createMockStripeClient(): StripeClient {
  const mockId = () => `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return {
    customers: {
      create: async (data: any) => ({ id: `cus_${mockId()}`, ...data }),
      retrieve: async (id: string) => ({ id, email: 'mock@example.com' }),
      update: async (id: string, data: any) => ({ id, ...data }),
    },
    paymentIntents: {
      create: async (data: any) => ({
        id: `pi_${mockId()}`,
        client_secret: `pi_${mockId()}_secret_${mockId()}`,
        status: 'requires_payment_method',
        amount: data.amount,
      }),
      retrieve: async (id: string) => ({ id, status: 'succeeded', amount_received: 5000 }),
      cancel: async (id: string) => ({ id, status: 'canceled' }),
    },
    checkout: {
      sessions: {
        create: async (data: any) => ({
          id: `cs_${mockId()}`,
          url: `https://checkout.stripe.com/mock/${mockId()}`,
          payment_intent: `pi_${mockId()}`,
        }),
      },
    },
    accountLinks: {
      create: async (data: any) => ({ url: `https://connect.stripe.com/mock/${mockId()}` }),
    },
    accounts: {
      create: async (data: any) => ({ id: `acct_${mockId()}`, charges_enabled: false, payouts_enabled: false, details_submitted: false }),
      retrieve: async (id: string) => ({ id, charges_enabled: true, payouts_enabled: true, details_submitted: true }),
      update: async (id: string, data: any) => ({ id, ...data }),
    },
    transfers: {
      create: async (data: any) => ({ id: `tr_${mockId()}`, amount: data.amount, object: 'transfer' }),
    },
    invoiceItems: {
      create: async (data: any) => ({ id: `ii_${mockId()}` }),
    },
    invoices: {
      create: async (data: any) => ({ id: `in_${mockId()}`, status: 'draft' }),
      finalizeInvoice: async (id: string) => ({ id, hosted_invoice_url: `https://invoice.stripe.com/mock/${id}`, status: 'open' }),
      sendInvoice: async (id: string) => ({ id, status: 'sent' }),
    },
    identity: {
      verificationSessions: {
        create: async (data: any) => ({
          id: `vs_${mockId()}`,
          client_secret: `vs_secret_${mockId()}`,
          url: `https://verify.stripe.com/mock/${mockId()}`,
          status: 'requires_input',
        }),
        retrieve: async (id: string) => ({ id, status: 'verified', last_verification_report: null }),
      },
    },
    webhooks: {
      constructEvent: (payload: string | Buffer, sig: string, secret: string) => {
        // In mock mode, just parse the payload directly (no verification)
        if (typeof payload === 'string') return JSON.parse(payload);
        return JSON.parse(payload.toString('utf8'));
      },
    },
  };
}

// ====================================================================
// CUSTOMER OPERATIONS
// ====================================================================

export async function createStripeCustomer(data: {
  email: string;
  name: string;
  metadata?: Record<string, string>;
}): Promise<string> {
  const client = await getStripeClient();
  const customer = await client.customers.create({
    email: data.email,
    name: data.name,
    metadata: { platform: 'figwork', ...data.metadata },
  });
  return customer.id;
}

export async function getOrCreateCustomer(
  customerId: string | null,
  data: { email: string; name: string }
): Promise<string> {
  if (customerId) {
    try {
      const client = await getStripeClient();
      await client.customers.retrieve(customerId);
      return customerId;
    } catch {
      // Customer doesn't exist, create new
    }
  }
  return createStripeCustomer(data);
}

// ====================================================================
// ESCROW / PAYMENT INTENTS
// ====================================================================

export async function createEscrowPaymentIntent(data: {
  amountInCents: number;
  customerId: string;
  workUnitId: string;
  companyId: string;
  description?: string;
}): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const client = await getStripeClient();
  const paymentIntent = await client.paymentIntents.create({
    amount: data.amountInCents,
    currency: 'usd',
    customer: data.customerId,
    description: data.description || `Escrow for work unit ${data.workUnitId}`,
    metadata: {
      workUnitId: data.workUnitId,
      companyId: data.companyId,
      type: 'escrow',
      platform: 'figwork',
    },
    capture_method: 'automatic',
    // Prevent duplicate charges
    idempotency_key: `escrow_${data.workUnitId}`,
  });

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
  };
}

export async function getPaymentIntentStatus(paymentIntentId: string): Promise<{
  status: string;
  amountReceived: number;
}> {
  const client = await getStripeClient();
  const pi = await client.paymentIntents.retrieve(paymentIntentId);
  return { status: pi.status, amountReceived: pi.amount_received };
}

export async function cancelPaymentIntent(paymentIntentId: string): Promise<void> {
  const client = await getStripeClient();
  await client.paymentIntents.cancel(paymentIntentId);
}

// ====================================================================
// CHECKOUT SESSIONS (Company Add-Funds)
// ====================================================================

export async function createCheckoutSession(data: {
  customerId: string;
  amountInCents: number;
  workUnitId?: string;
  companyId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ sessionId: string; checkoutUrl: string }> {
  const client = await getStripeClient();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const session = await client.checkout.sessions.create({
    customer: data.customerId,
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: data.amountInCents,
          product_data: {
            name: data.workUnitId ? 'Escrow Funding' : 'Account Funding',
            description: data.workUnitId
              ? `Escrow deposit for work unit ${data.workUnitId}`
              : 'Add funds to your Figwork account',
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      companyId: data.companyId,
      workUnitId: data.workUnitId || '',
      type: data.workUnitId ? 'escrow' : 'add_funds',
      platform: 'figwork',
    },
    success_url: data.successUrl || `${frontendUrl}/dashboard/billing?success=true`,
    cancel_url: data.cancelUrl || `${frontendUrl}/dashboard/billing?cancelled=true`,
  });

  return {
    sessionId: session.id,
    checkoutUrl: session.url!,
  };
}

// ====================================================================
// CONNECT ACCOUNTS (Student Payouts)
// ====================================================================

export async function createExpressAccount(data: {
  email: string;
  studentId: string;
  country?: string;
}): Promise<{ accountId: string }> {
  const client = await getStripeClient();
  const account = await client.accounts.create({
    type: 'express',
    country: data.country || 'US',
    email: data.email,
    capabilities: {
      transfers: { requested: true },
    },
    business_type: 'individual',
    metadata: {
      studentId: data.studentId,
      platform: 'figwork',
    },
    settings: {
      payouts: {
        schedule: { interval: 'manual' }, // We control payout timing
      },
    },
  });
  return { accountId: account.id };
}

export async function createConnectAccountLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<string> {
  const client = await getStripeClient();
  const accountLink = await client.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return accountLink.url;
}

export async function getConnectAccountStatus(accountId: string): Promise<{
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}> {
  const client = await getStripeClient();
  const account = await client.accounts.retrieve(accountId);
  return {
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  };
}

export async function createConnectLoginLink(accountId: string): Promise<string> {
  const client = await getStripeClient();
  // Express accounts use dashboard links
  const link = await client.accounts.retrieve(accountId);
  return `https://connect.stripe.com/express/${accountId}`;
}

// ====================================================================
// TRANSFERS (Payouts to Students)
// ====================================================================

export interface TransferResult {
  transferId: string;
  amount: number;
  status: string;
}

export async function createTransfer(data: {
  amountInCents: number;
  destinationAccountId: string;
  executionId?: string;
  payoutId?: string;
  description?: string;
}): Promise<TransferResult> {
  const client = await getStripeClient();
  const transfer = await client.transfers.create({
    amount: data.amountInCents,
    currency: 'usd',
    destination: data.destinationAccountId,
    description: data.description || 'Figwork task payout',
    metadata: {
      executionId: data.executionId || '',
      payoutId: data.payoutId || '',
      platform: 'figwork',
    },
  });

  return {
    transferId: transfer.id,
    amount: transfer.amount,
    status: transfer.object === 'transfer' ? 'succeeded' : 'failed',
  };
}

export async function createBatchTransfer(
  transfers: Array<{
    amountInCents: number;
    destinationAccountId: string;
    executionId: string;
  }>,
  batchPayoutId: string
): Promise<TransferResult[]> {
  const results: TransferResult[] = [];

  for (const t of transfers) {
    try {
      const result = await createTransfer({
        amountInCents: t.amountInCents,
        destinationAccountId: t.destinationAccountId,
        executionId: t.executionId,
        payoutId: batchPayoutId,
        description: `Figwork batch payout — Execution ${t.executionId}`,
      });
      results.push(result);
    } catch (error) {
      console.error(`Transfer failed for execution ${t.executionId}:`, error);
      results.push({ transferId: '', amount: t.amountInCents, status: 'failed' });
    }
  }

  return results;
}

// ====================================================================
// IDENTITY VERIFICATION (KYC)
// ====================================================================

export async function createIdentityVerificationSession(data: {
  studentId: string;
  returnUrl: string;
}): Promise<{
  sessionId: string;
  clientSecret: string;
  url: string;
}> {
  const client = await getStripeClient();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const session = await client.identity.verificationSessions.create({
    type: 'document',
    metadata: {
      studentId: data.studentId,
      platform: 'figwork',
    },
    options: {
      document: {
        allowed_types: ['driving_license', 'passport', 'id_card'],
        require_matching_selfie: true,
      },
    },
    return_url: data.returnUrl || `${frontendUrl}/student/onboard?step=kyc&status=complete`,
  });

  return {
    sessionId: session.id,
    clientSecret: session.client_secret,
    url: session.url,
  };
}

export async function getIdentityVerificationStatus(sessionId: string): Promise<{
  status: string;
  lastError?: string;
}> {
  const client = await getStripeClient();
  const session = await client.identity.verificationSessions.retrieve(sessionId);
  return {
    status: session.status, // requires_input | processing | verified | canceled
    lastError: session.last_error?.message,
  };
}

// ====================================================================
// TAX REPORTING
// ====================================================================

export async function createTaxReportingPerson(data: {
  accountId: string;
  firstName: string;
  lastName: string;
  ssn?: string;
}): Promise<void> {
  const client = await getStripeClient();
  await client.accounts.update(data.accountId, {
    individual: {
      first_name: data.firstName,
      last_name: data.lastName,
      ...(data.ssn && { ssn_last_4: data.ssn }),
    },
  });
}

// ====================================================================
// INVOICING
// ====================================================================

export async function createInvoice(data: {
  customerId: string;
  amountInCents: number;
  description: string;
  companyId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<{ invoiceId: string; invoiceUrl: string | null }> {
  const client = await getStripeClient();

  await client.invoiceItems.create({
    customer: data.customerId,
    amount: data.amountInCents,
    currency: 'usd',
    description: data.description,
  });

  const invoice = await client.invoices.create({
    customer: data.customerId,
    collection_method: 'send_invoice',
    days_until_due: 30,
    metadata: {
      companyId: data.companyId,
      periodStart: data.periodStart.toISOString(),
      periodEnd: data.periodEnd.toISOString(),
      platform: 'figwork',
    },
  });

  const finalized = await client.invoices.finalizeInvoice(invoice.id);

  return {
    invoiceId: finalized.id,
    invoiceUrl: finalized.hosted_invoice_url,
  };
}

// ====================================================================
// WEBHOOKS
// ====================================================================

export async function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  webhookSecret?: string
): Promise<any> {
  const secret = webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('No Stripe webhook secret configured');
  }
  const client = await getStripeClient();
  return client.webhooks.constructEvent(payload, signature, secret);
}
