/**
 * Email Service — Production-Ready
 *
 * Handles transactional emails using Resend (primary) or SendGrid (fallback):
 * - Task assignment / revision / completion notifications
 * - Payout confirmations
 * - Weekly quality reports
 * - Dispute updates
 * - Onboarding welcome / KYC reminders
 * - Contract signing reminders
 * - Security alerts (password change, new login)
 *
 * CONFIGURATION:
 *   RESEND_API_KEY         — Resend API key (re_xxxxxxx)
 *   SENDGRID_API_KEY       — SendGrid API key (SG.xxxxxxx) — fallback
 *   EMAIL_FROM             — Sender email (noreply@figwork.com)
 *   EMAIL_FROM_NAME        — Sender display name (Figwork)
 *   EMAIL_REPLY_TO         — Reply-to address (support@figwork.com)
 *   FRONTEND_URL           — For deep links in emails
 */

// ─── Configuration ──────────────────────────────────────────────────

interface EmailConfig {
  provider: 'resend' | 'sendgrid' | 'mock';
  apiKey: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
}

function getConfig(): EmailConfig {
  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;

  if (resendKey) {
    return {
      provider: 'resend',
      apiKey: resendKey,
      fromEmail: process.env.EMAIL_FROM || 'noreply@figwork.com',
      fromName: process.env.EMAIL_FROM_NAME || 'Figwork',
      replyTo: process.env.EMAIL_REPLY_TO || 'support@figwork.com',
    };
  }

  if (sendgridKey) {
    return {
      provider: 'sendgrid',
      apiKey: sendgridKey,
      fromEmail: process.env.EMAIL_FROM || 'noreply@figwork.com',
      fromName: process.env.EMAIL_FROM_NAME || 'Figwork',
      replyTo: process.env.EMAIL_REPLY_TO || 'support@figwork.com',
    };
  }

  return {
    provider: 'mock',
    apiKey: '',
    fromEmail: 'noreply@figwork.com',
    fromName: 'Figwork',
    replyTo: 'support@figwork.com',
  };
}

export function isEmailConfigured(): boolean {
  return getConfig().provider !== 'mock';
}

// ====================================================================
// CORE SENDING
// ====================================================================

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: string[];
  /** Scheduled send time (ISO 8601) — Resend only */
  scheduledAt?: string;
}

export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  const config = getConfig();

  if (config.provider === 'mock') {
    const recipients = Array.isArray(options.to) ? options.to.join(', ') : options.to;
    console.log(`[Email Mock] To: ${recipients} | Subject: ${options.subject}`);
    return { success: true, messageId: `mock_email_${Date.now()}` };
  }

  if (config.provider === 'resend') {
    return sendViaResend(config, options);
  }

  if (config.provider === 'sendgrid') {
    return sendViaSendGrid(config, options);
  }

  return { success: false, error: 'No email provider configured' };
}

async function sendViaResend(
  config: EmailConfig,
  options: EmailOptions
): Promise<SendEmailResult> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
        reply_to: options.replyTo || config.replyTo,
        tags: options.tags?.map((t) => ({ name: 'category', value: t })),
        ...(options.scheduledAt && { scheduled_at: options.scheduledAt }),
      }),
    });

    const data = (await response.json()) as { id?: string; message?: string };

    if (!response.ok) {
      console.error('[Email] Resend error:', data);
      return { success: false, error: data.message || `Resend API error ${response.status}` };
    }

    return { success: true, messageId: data.id };
  } catch (error: any) {
    console.error('[Email] Resend error:', error.message);
    return { success: false, error: error.message };
  }
}

async function sendViaSendGrid(
  config: EmailConfig,
  options: EmailOptions
): Promise<SendEmailResult> {
  try {
    const toList = Array.isArray(options.to)
      ? options.to.map((email) => ({ email }))
      : [{ email: options.to }];

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: toList }],
        from: { email: config.fromEmail, name: config.fromName },
        subject: options.subject,
        content: [
          { type: 'text/plain', value: options.text || options.subject },
          { type: 'text/html', value: options.html },
        ],
        reply_to: { email: options.replyTo || config.replyTo },
        categories: options.tags,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `SendGrid error ${response.status}: ${text}` };
    }

    const messageId = response.headers.get('x-message-id') || `sg_${Date.now()}`;
    return { success: true, messageId };
  } catch (error: any) {
    console.error('[Email] SendGrid error:', error.message);
    return { success: false, error: error.message };
  }
}

// ====================================================================
// HTML BASE TEMPLATE
// ====================================================================

const baseTemplate = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f9fafb; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .logo { font-size: 24px; font-weight: 700; color: #8B5CF6; margin-bottom: 24px; }
    h1 { font-size: 20px; color: #111827; margin: 0 0 16px 0; }
    h2 { font-size: 16px; color: #374151; margin: 24px 0 8px 0; }
    p { font-size: 16px; color: #4B5563; line-height: 1.6; margin: 0 0 16px 0; }
    .button { display: inline-block; background: linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%); color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; margin: 16px 0; }
    .button-secondary { display: inline-block; background: #f3f4f6; color: #374151; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 500; margin: 8px 0; border: 1px solid #d1d5db; }
    .footer { margin-top: 32px; padding-top: 24px; border-top: 1px solid #E5E7EB; font-size: 14px; color: #9CA3AF; }
    .footer a { color: #8B5CF6; text-decoration: none; }
    .highlight { background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .stat { font-size: 24px; font-weight: 700; color: #8B5CF6; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-success { background: #ECFDF5; color: #065F46; }
    .badge-warning { background: #FFFBEB; color: #92400E; }
    .badge-error { background: #FEF2F2; color: #991B1B; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">Figwork</div>
      ${content}
      <div class="footer">
        <p>This email was sent by <a href="${process.env.FRONTEND_URL || 'https://www.figwork.com'}">Figwork</a>. If you have questions, reply to this email or contact <a href="mailto:support@figwork.com">support@figwork.com</a>.</p>
        <p style="font-size: 12px; margin-top: 8px;"><a href="${process.env.FRONTEND_URL || 'https://www.figwork.com'}/terms">Terms</a> · <a href="${process.env.FRONTEND_URL || 'https://www.figwork.com'}/privacy">Privacy</a></p>
      </div>
    </div>
  </div>
</body>
</html>
`;

// ====================================================================
// NOTIFICATION EMAILS
// ====================================================================

export async function sendWelcomeEmail(
  to: string,
  data: { name: string; dashboardUrl: string }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Welcome to Figwork! 🎉</h1>
    <p>Hi ${data.name},</p>
    <p>Thanks for joining Figwork! You're now part of a marketplace that connects talented students with real-world work opportunities.</p>
    <p>Here's what's next:</p>
    <div class="highlight">
      <p style="margin: 0 0 8px 0;"><strong>1.</strong> Complete your profile and onboarding</p>
      <p style="margin: 0 0 8px 0;"><strong>2.</strong> Browse available tasks</p>
      <p style="margin: 0;"><strong>3.</strong> Accept a task and start earning!</p>
    </div>
    <a href="${data.dashboardUrl}" class="button">Go to Dashboard</a>
  `);

  return sendEmail({ to, subject: '🎉 Welcome to Figwork!', html, tags: ['welcome'] });
}

export async function sendTaskAssignedEmail(
  to: string,
  data: {
    studentName: string;
    taskTitle: string;
    taskDescription: string;
    priceInCents: number;
    deadlineHours: number;
    dashboardUrl: string;
  }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>New Task Assigned!</h1>
    <p>Hi ${data.studentName},</p>
    <p>You've been assigned a new task on Figwork:</p>
    <div class="highlight">
      <h2 style="margin: 0 0 8px 0; color: #111827;">${data.taskTitle}</h2>
      <p style="margin: 0;">${data.taskDescription.substring(0, 200)}${data.taskDescription.length > 200 ? '...' : ''}</p>
    </div>
    <p><strong>Pay:</strong> $${(data.priceInCents / 100).toFixed(2)}<br>
    <strong>Deadline:</strong> ${data.deadlineHours} hours from now</p>
    <a href="${data.dashboardUrl}" class="button">View Task Details</a>
    <p>Remember to clock in when you start and submit proof of work regularly. Good luck!</p>
  `);

  return sendEmail({ to, subject: `📋 New Task: ${data.taskTitle}`, html, tags: ['task-assigned'] });
}

export async function sendRevisionRequestedEmail(
  to: string,
  data: {
    studentName: string;
    taskTitle: string;
    feedback: string;
    deadlineHours: number;
    dashboardUrl: string;
  }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Revision Requested</h1>
    <p>Hi ${data.studentName},</p>
    <p>Your submission for <strong>${data.taskTitle}</strong> needs some revisions:</p>
    <div class="highlight">
      <p style="margin: 0;">${data.feedback}</p>
    </div>
    <p>Please address the feedback and resubmit within <strong>${data.deadlineHours} hours</strong>.</p>
    <a href="${data.dashboardUrl}" class="button">View Full Feedback</a>
  `);

  return sendEmail({ to, subject: `🔄 Revision Needed: ${data.taskTitle}`, html, tags: ['revision-requested'] });
}

export async function sendTaskApprovedEmail(
  to: string,
  data: {
    studentName: string;
    taskTitle: string;
    amountInCents: number;
    dashboardUrl: string;
  }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Task Approved! 🎉</h1>
    <p>Hi ${data.studentName},</p>
    <p>Great news — your work on <strong>${data.taskTitle}</strong> has been approved!</p>
    <div class="highlight" style="text-align: center;">
      <div class="stat">$${(data.amountInCents / 100).toFixed(2)}</div>
      <p style="margin: 4px 0 0 0;">has been added to your pending payout</p>
    </div>
    <a href="${data.dashboardUrl}" class="button">View Earnings</a>
  `);

  return sendEmail({ to, subject: `✅ Task Approved: ${data.taskTitle}`, html, tags: ['task-approved'] });
}

export async function sendPayoutCompletedEmail(
  to: string,
  data: {
    studentName: string;
    amountInCents: number;
    taskCount: number;
    periodStart: string;
    periodEnd: string;
  }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Payout Complete! 🎉</h1>
    <p>Hi ${data.studentName},</p>
    <p>Great news! Your payout has been processed.</p>
    <div class="highlight" style="text-align: center;">
      <div class="stat">$${(data.amountInCents / 100).toFixed(2)}</div>
      <p style="margin: 4px 0 0 0;">for ${data.taskCount} task${data.taskCount > 1 ? 's' : ''}</p>
    </div>
    <p>The funds should arrive in your connected bank account within 1–2 business days.</p>
    <p style="font-size: 14px; color: #6B7280;">Period: ${data.periodStart} – ${data.periodEnd}</p>
  `);

  return sendEmail({ to, subject: `💰 Payout: $${(data.amountInCents / 100).toFixed(2)} deposited`, html, tags: ['payout-completed'] });
}

export async function sendWeeklyReportEmail(
  to: string,
  data: {
    companyName: string;
    periodStart: string;
    periodEnd: string;
    totalTasks: number;
    completedTasks: number;
    defectRate: number;
    totalSpent: number;
    recommendations: string[];
    dashboardUrl: string;
  }
): Promise<SendEmailResult> {
  const recommendationsHtml =
    data.recommendations.length > 0
      ? `<h2>Recommendations</h2><ul style="padding-left: 20px;">${data.recommendations.map((r) => `<li>${r}</li>`).join('')}</ul>`
      : '';

  const html = baseTemplate(`
    <h1>Weekly Quality Report</h1>
    <p>Hi ${data.companyName} team,</p>
    <p>Here's your Figwork summary for ${data.periodStart} – ${data.periodEnd}:</p>
    <div class="highlight" style="text-align: center;">
      <table style="width:100%; text-align:center;">
        <tr>
          <td><div class="stat">${data.completedTasks}</div><p style="margin:4px 0 0;font-size:12px;">Tasks Completed</p></td>
          <td><div class="stat">${Math.round(data.defectRate * 100)}%</div><p style="margin:4px 0 0;font-size:12px;">Defect Rate</p></td>
          <td><div class="stat">$${(data.totalSpent / 100).toFixed(0)}</div><p style="margin:4px 0 0;font-size:12px;">Total Spent</p></td>
        </tr>
      </table>
    </div>
    ${recommendationsHtml}
    <a href="${data.dashboardUrl}" class="button">View Full Report</a>
  `);

  return sendEmail({
    to,
    subject: `📊 Weekly Report: ${data.completedTasks} tasks, ${Math.round(data.defectRate * 100)}% defect rate`,
    html,
    tags: ['weekly-report'],
  });
}

export async function sendDisputeUpdateEmail(
  to: string,
  data: {
    recipientName: string;
    disputeId: string;
    taskTitle: string;
    status: string;
    resolution?: string;
    dashboardUrl: string;
  }
): Promise<SendEmailResult> {
  const statusText =
    data.status === 'resolved_student'
      ? 'resolved in your favor'
      : data.status === 'resolved_company'
        ? 'resolved in favor of the company'
        : data.status === 'partial'
          ? 'partially resolved'
          : 'updated';

  const html = baseTemplate(`
    <h1>Dispute Update</h1>
    <p>Hi ${data.recipientName},</p>
    <p>Your dispute regarding <strong>${data.taskTitle}</strong> has been ${statusText}.</p>
    ${data.resolution ? `<div class="highlight"><p style="margin: 0;"><strong>Resolution:</strong> ${data.resolution}</p></div>` : ''}
    <a href="${data.dashboardUrl}" class="button">View Details</a>
  `);

  return sendEmail({ to, subject: `⚖️ Dispute ${statusText}: ${data.taskTitle}`, html, tags: ['dispute-update'] });
}

// ====================================================================
// ONBOARDING / KYC EMAILS
// ====================================================================

export async function sendKYCReminderEmail(
  to: string,
  data: { studentName: string; onboardUrl: string }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Complete Your Identity Verification</h1>
    <p>Hi ${data.studentName},</p>
    <p>Your Figwork account is almost ready! Please complete identity verification (KYC) to start accepting tasks.</p>
    <p>The process takes about 2 minutes and requires a government-issued photo ID.</p>
    <a href="${data.onboardUrl}" class="button">Complete Verification</a>
    <p style="font-size: 14px; color: #9CA3AF;">This is a one-time verification required for all contractors on Figwork.</p>
  `);

  return sendEmail({ to, subject: '🔐 Complete your identity verification', html, tags: ['kyc-reminder'] });
}

export async function sendContractReadyEmail(
  to: string,
  data: {
    studentName: string;
    agreementName: string;
    signingUrl: string;
  }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Your Agreement is Ready for Signing</h1>
    <p>Hi ${data.studentName},</p>
    <p>Your <strong>${data.agreementName}</strong> is ready for review and signing. Please review the document carefully and sign it to continue.</p>
    <a href="${data.signingUrl}" class="button">Review & Sign</a>
    <p style="font-size: 14px; color: #9CA3AF;">This document is legally binding. Contact support@figwork.com if you have questions.</p>
  `);

  return sendEmail({ to, subject: `📝 Please sign: ${data.agreementName}`, html, tags: ['contract-ready'] });
}

export async function sendConnectOnboardingEmail(
  to: string,
  data: { studentName: string; connectUrl: string }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Set Up Your Payout Account</h1>
    <p>Hi ${data.studentName},</p>
    <p>To receive payments for your work on Figwork, please connect your bank account through our secure payment partner, Stripe.</p>
    <p>The setup takes about 5 minutes.</p>
    <a href="${data.connectUrl}" class="button">Set Up Payouts</a>
    <p style="font-size: 14px; color: #9CA3AF;">Your financial information is securely handled by Stripe and never stored on Figwork servers.</p>
  `);

  return sendEmail({ to, subject: '🏦 Set up your payout account', html, tags: ['connect-onboarding'] });
}

// ====================================================================
// SECURITY EMAILS
// ====================================================================

export async function sendSecurityAlertEmail(
  to: string,
  data: {
    name: string;
    event: string;
    details: string;
    ipAddress?: string;
    timestamp: string;
  }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Security Alert</h1>
    <p>Hi ${data.name},</p>
    <p>We detected the following activity on your Figwork account:</p>
    <div class="highlight">
      <p style="margin: 0 0 4px 0;"><strong>${data.event}</strong></p>
      <p style="margin: 0; font-size: 14px;">${data.details}</p>
      ${data.ipAddress ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #9CA3AF;">IP: ${data.ipAddress}</p>` : ''}
      <p style="margin: 4px 0 0 0; font-size: 12px; color: #9CA3AF;">Time: ${data.timestamp}</p>
    </div>
    <p>If this wasn't you, please <a href="mailto:support@figwork.com">contact support</a> immediately.</p>
  `);

  return sendEmail({ to, subject: `🚨 Security Alert: ${data.event}`, html, tags: ['security-alert'] });
}

// ====================================================================
// COMPANY EMAILS
// ====================================================================

export async function sendEscrowFundedEmail(
  to: string,
  data: {
    companyName: string;
    taskTitle: string;
    amountInCents: number;
    dashboardUrl: string;
  }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Escrow Funded</h1>
    <p>Hi ${data.companyName} team,</p>
    <p>Your escrow for <strong>${data.taskTitle}</strong> has been funded.</p>
    <div class="highlight" style="text-align: center;">
      <div class="stat">$${(data.amountInCents / 100).toFixed(2)}</div>
      <p style="margin: 4px 0 0 0;">held in escrow</p>
    </div>
    <p>The task is now live and available for contractors. You'll be notified when work begins.</p>
    <a href="${data.dashboardUrl}" class="button">View Task</a>
  `);

  return sendEmail({ to, subject: `✅ Escrow funded: ${data.taskTitle}`, html, tags: ['escrow-funded'] });
}

export async function sendInvoiceReadyEmail(
  to: string,
  data: {
    companyName: string;
    totalInCents: number;
    periodStart: string;
    periodEnd: string;
    invoiceUrl: string;
  }
): Promise<SendEmailResult> {
  const html = baseTemplate(`
    <h1>Your Invoice is Ready</h1>
    <p>Hi ${data.companyName} team,</p>
    <p>Your Figwork invoice for ${data.periodStart} – ${data.periodEnd} is ready.</p>
    <div class="highlight" style="text-align: center;">
      <div class="stat">$${(data.totalInCents / 100).toFixed(2)}</div>
      <p style="margin: 4px 0 0 0;">total due</p>
    </div>
    <a href="${data.invoiceUrl}" class="button">View & Pay Invoice</a>
    <p style="font-size: 14px; color: #9CA3AF;">Payment is due within 30 days.</p>
  `);

  return sendEmail({ to, subject: `📄 Invoice ready: $${(data.totalInCents / 100).toFixed(2)}`, html, tags: ['invoice-ready'] });
}
