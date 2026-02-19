import { Queue } from 'bullmq';
import { getRedis } from './redis.js';
import { QUEUE_NAMES } from '@figwork/shared';

const connection = getRedis();

// Knowledge processing queue
export const knowledgeQueue = new Queue(QUEUE_NAMES.KNOWLEDGE_PROCESSING, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// Candidate file processing queue
export const candidateFileQueue = new Queue(QUEUE_NAMES.CANDIDATE_FILE_PROCESSING, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// Post-processing queue (summary generation)
export const postProcessQueue = new Queue(QUEUE_NAMES.POST_PROCESSING, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 1000,
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// PDF generation queue
export const pdfQueue = new Queue(QUEUE_NAMES.PDF_GENERATION, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// QA check queue
export const qaQueue = new Queue(QUEUE_NAMES.QA_CHECK, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// POW (Proof of Work) analysis queue
export const powQueue = new Queue(QUEUE_NAMES.POW_ANALYSIS, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Notification queue
export const notificationQueue = new Queue(QUEUE_NAMES.NOTIFICATION, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 500,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// Payout processing queue
export const payoutQueue = new Queue(QUEUE_NAMES.PAYOUT_PROCESS, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

// Invoice generation queue
export const invoiceQueue = new Queue(QUEUE_NAMES.INVOICE_GENERATION, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

// Helper functions to get queues
export function getQAQueue() {
  return qaQueue;
}

export function getPOWQueue() {
  return powQueue;
}

export function getNotificationQueue() {
  return notificationQueue;
}

export function getPayoutQueue() {
  return payoutQueue;
}

export function getInvoiceQueue() {
  return invoiceQueue;
}
