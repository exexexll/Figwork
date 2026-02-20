import { Worker, Job } from 'bullmq';
import { getBullMQRedis } from '../lib/redis.js';
import { db } from '@figwork/db';
import { QUEUE_NAMES } from '@figwork/shared';
import { sendSMS as sendTwilioSMS, isTwilioConfigured } from '../lib/twilio-service.js';
import { sendEmail as sendEmailService, isEmailConfigured } from '../lib/email-service.js';

interface NotificationJobData {
  notificationId?: string;
  userId: string;
  userType: 'student' | 'company' | 'admin';
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  channels: ('in_app' | 'email' | 'sms' | 'push')[];
}

interface SMSJobData {
  phone: string;
  message: string;
  type: string;
  metadata?: Record<string, any>;
}

interface EmailJobData {
  email: string;
  subject: string;
  body: string;
  template?: string;
  data?: Record<string, any>;
}

async function processNotificationJob(job: Job<NotificationJobData | SMSJobData | EmailJobData>) {
  if (job.name === 'send_notification') {
    return await sendNotification(job.data as NotificationJobData);
  } else if (job.name === 'send_sms') {
    return await sendSMS(job.data as SMSJobData);
  } else if (job.name === 'send_email') {
    return await sendEmail(job.data as EmailJobData);
  } else if (job.name === 'process_pending') {
    return await processPendingNotifications();
  }
}

async function sendNotification(data: NotificationJobData) {
  const { notificationId, userId, userType, type, title, body, data: notificationData, channels } = data;
  
  console.log(`[Notification] Sending notification to ${userType}:${userId}`);

  // Create notification record if not exists
  let notification;
  if (notificationId) {
    notification = await db.notification.findUnique({ where: { id: notificationId } });
  }

  if (!notification) {
    notification = await db.notification.create({
      data: {
        userId,
        userType,
        type,
        title,
        body,
        data: notificationData || {},
        channels,
        sentChannels: [],
      },
    });
  }

  const sentChannels: string[] = [];
  const errors: string[] = [];

  // Send to each channel
  for (const channel of channels) {
    try {
      switch (channel) {
        case 'in_app':
          // In-app notifications are already stored in the database
          sentChannels.push('in_app');
          break;

        case 'email':
          // Get user email
          let email: string | null = null;
          
          if (userType === 'student') {
            const student = await db.studentProfile.findFirst({
              where: { OR: [{ clerkId: userId }, { id: userId }] },
              select: { email: true },
            });
            email = student?.email || null;
          } else if (userType === 'company') {
            const user = await db.user.findUnique({
              where: { id: userId },
              select: { email: true },
            });
            email = user?.email || null;
          }

          if (email) {
            await sendEmailToAddress(email, title, body, notificationData);
            sentChannels.push('email');
          }
          break;

        case 'sms':
          // Get user phone
          let phone: string | null = null;
          
          if (userType === 'student') {
            const student = await db.studentProfile.findFirst({
              where: { OR: [{ clerkId: userId }, { id: userId }] },
              select: { phone: true },
            });
            phone = student?.phone || null;
          }

          if (phone) {
            await sendSMSToPhone(phone, body, type);
            sentChannels.push('sms');
          }
          break;

        case 'push':
          // Push notifications require FCM/APNs integration — skipped in current version
          break;
      }
    } catch (error) {
      console.error(`[Notification] Failed to send via ${channel}:`, error);
      errors.push(`${channel}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Update notification record
  await db.notification.update({
    where: { id: notification.id },
    data: {
      sentChannels,
    },
  });

  console.log(`[Notification] Sent via: ${sentChannels.join(', ')}`);

  return {
    notificationId: notification.id,
    sentChannels,
    errors,
  };
}

async function sendSMS(data: SMSJobData) {
  const { phone, message, type, metadata } = data;
  
  console.log(`[SMS] Sending SMS to ${phone}`);

  try {
    // Send via Twilio
    const result = await sendTwilioSMS(phone, message);

    if (!result.success) {
      throw new Error(result.error || 'SMS send failed');
    }

    // Log SMS
    await db.sMSLog.create({
      data: {
        phone,
        message,
        type,
        twilioMessageId: result.messageId || `mock_${Date.now()}`,
        status: 'sent',
      },
    });

    console.log(`[SMS] Sent: ${result.messageId}`);

    return {
      messageId: result.messageId,
      status: 'sent',
    };

  } catch (error) {
    console.error(`[SMS] Failed to send to ${phone}:`, error);

    await db.sMSLog.create({
      data: {
        phone,
        message,
        type,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}

async function sendSMSToPhone(phone: string, message: string, type: string) {
  return sendSMS({ phone, message, type });
}

async function sendEmail(data: EmailJobData) {
  const { email, subject, body, template, data: templateData } = data;
  
  console.log(`[Email] Sending email to ${email}`);

  try {
    // Send via email service (Resend or SendGrid)
    const result = await sendEmailService({
      to: email,
      subject,
      html: body,
      text: body.replace(/<[^>]*>/g, ''), // Strip HTML for text version
      tags: template ? [template] : undefined,
    });

    if (!result.success) {
      throw new Error(result.error || 'Email send failed');
    }

    console.log(`[Email] Sent to ${email}: ${result.messageId}`);

    return {
      email,
      status: 'sent',
      messageId: result.messageId,
    };

  } catch (error) {
    console.error(`[Email] Failed to send to ${email}:`, error);
    throw error;
  }
}

async function sendEmailToAddress(email: string, subject: string, body: string, data?: Record<string, any>) {
  return sendEmail({ email, subject, body, data });
}

async function processPendingNotifications() {
  console.log('[Notification] Processing pending notifications');

  // Find notifications that haven't been sent to all channels
  const pending = await db.notification.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
    },
    take: 100,
  });

  let processed = 0;
  let errors = 0;

  for (const notification of pending) {
    const pendingChannels = notification.channels.filter(
      c => !notification.sentChannels.includes(c)
    );

    if (pendingChannels.length === 0) continue;

    try {
      await sendNotification({
        notificationId: notification.id,
        userId: notification.userId,
        userType: notification.userType as 'student' | 'company' | 'admin',
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data as Record<string, any>,
        channels: pendingChannels as ('in_app' | 'email' | 'sms' | 'push')[],
      });
      processed++;
    } catch (error) {
      console.error(`[Notification] Error processing ${notification.id}:`, error);
      errors++;
    }
  }

  console.log(`[Notification] Processed ${processed} notifications, ${errors} errors`);

  return { processed, errors };
}

export function startNotificationWorker() {
  const worker = new Worker(
    QUEUE_NAMES.NOTIFICATION,
    processNotificationJob,
    {
      connection: getBullMQRedis(),
      concurrency: 10,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Notification Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Notification Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[Notification Worker] Started');
  return worker;
}
