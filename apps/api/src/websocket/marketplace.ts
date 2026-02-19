/**
 * WebSocket Marketplace Events
 * 
 * Real-time events for the gig marketplace:
 * - POW requests and responses
 * - Task assignments and status changes
 * - Payout completions
 * - Early warnings and notifications
 */

import { Server, Socket } from 'socket.io';
import { db } from '@figwork/db';

// Event types
export const MARKETPLACE_EVENTS = {
  // POW Events
  POW_REQUEST: 'marketplace:pow:request',
  POW_SUBMITTED: 'marketplace:pow:submitted',
  POW_VERIFIED: 'marketplace:pow:verified',
  POW_FAILED: 'marketplace:pow:failed',

  // Task Events
  TASK_ASSIGNED: 'marketplace:task:assigned',
  TASK_STARTED: 'marketplace:task:started',
  TASK_SUBMITTED: 'marketplace:task:submitted',
  TASK_APPROVED: 'marketplace:task:approved',
  TASK_REVISION: 'marketplace:task:revision',
  TASK_FAILED: 'marketplace:task:failed',

  // Milestone Events
  MILESTONE_COMPLETED: 'marketplace:milestone:completed',

  // Payout Events
  PAYOUT_PENDING: 'marketplace:payout:pending',
  PAYOUT_PROCESSING: 'marketplace:payout:processing',
  PAYOUT_COMPLETED: 'marketplace:payout:completed',

  // Warning Events
  WARNING_DEADLINE: 'marketplace:warning:deadline',
  WARNING_INACTIVITY: 'marketplace:warning:inactivity',
  WARNING_POW: 'marketplace:warning:pow',

  // Coaching Events
  COACHING_MESSAGE: 'marketplace:coaching:message',
} as const;

// Room naming conventions
function getStudentRoom(studentId: string): string {
  return `student:${studentId}`;
}

function getCompanyRoom(companyId: string): string {
  return `company:${companyId}`;
}

function getExecutionRoom(executionId: string): string {
  return `execution:${executionId}`;
}

/**
 * Setup marketplace namespace for WebSocket
 */
export function setupMarketplaceNamespace(io: Server): void {
  const marketplace = io.of('/marketplace');

  marketplace.on('connection', async (socket: Socket) => {
    const { userType, userId } = socket.handshake.auth;

    if (!userType || !userId) {
      socket.emit('error', { message: 'Authentication required' });
      socket.disconnect();
      return;
    }

    try {
    // Join appropriate rooms based on user type
    if (userType === 'student') {
      // Look up student by Clerk ID
      const student = await db.studentProfile.findUnique({
        where: { clerkId: userId },
        select: { id: true },
      });

      if (!student) {
        // No profile yet — disconnect silently (user may not have onboarded)
        socket.disconnect();
        return;
      }

      const resolvedStudentId = student.id;

      // Join student room
      socket.join(getStudentRoom(resolvedStudentId));

      // Join rooms for active executions
      const activeExecutions = await db.execution.findMany({
        where: {
          studentId: resolvedStudentId,
          status: { in: ['accepted', 'clocked_in', 'submitted', 'revision_needed'] },
        },
        select: { id: true },
      });

      for (const exec of activeExecutions) {
        socket.join(getExecutionRoom(exec.id));
      }

      console.log(`[WS Marketplace] Student ${resolvedStudentId} connected`);
    } else if (userType === 'company') {
      // Look up company by Clerk ID → User → CompanyProfile
      const user = await db.user.findUnique({
        where: { clerkId: userId },
        select: { id: true },
      });

      if (!user) {
        socket.disconnect();
        return;
      }

      const company = await db.companyProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });

      if (!company) {
        // No company profile yet — disconnect silently
        socket.disconnect();
        return;
      }

      const resolvedCompanyId = company.id;

      // Join company room
      socket.join(getCompanyRoom(resolvedCompanyId));

      // Join rooms for active work units
      const activeWorkUnits = await db.workUnit.findMany({
        where: {
          companyId: resolvedCompanyId,
          status: { in: ['active', 'in_progress', 'review_pending'] },
        },
        include: {
          executions: {
            where: { status: { in: ['accepted', 'clocked_in', 'submitted', 'revision_needed'] } },
            select: { id: true },
          },
        },
      });

      for (const wu of activeWorkUnits) {
        for (const exec of wu.executions) {
          socket.join(getExecutionRoom(exec.id));
        }
      }

      console.log(`[WS Marketplace] Company ${resolvedCompanyId} connected`);
    }

    } catch (error) {
      // Catch any DB errors to prevent server crash
      console.error(`[WS Marketplace] Auth error for ${userType}:${userId}:`, error);
      socket.disconnect();
      return;
    }

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`[WS Marketplace] User ${userId} disconnected`);
    });

    // Allow clients to subscribe to specific executions
    socket.on('subscribe:execution', async (executionId: string) => {
      try {
      // Verify access
      const execution = await db.execution.findUnique({
        where: { id: executionId },
        include: { workUnit: { select: { companyId: true } } },
      });

      if (!execution) return;

      // For subscription auth, look up real IDs from authenticated user
      let hasAccess = false;
      if (userType === 'student') {
        const student = await db.studentProfile.findUnique({ where: { clerkId: userId }, select: { id: true } });
        hasAccess = !!student && execution.studentId === student.id;
      } else if (userType === 'company') {
        const user = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
        if (user) {
          const company = await db.companyProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
          hasAccess = !!company && execution.workUnit.companyId === company.id;
        }
      }

      if (hasAccess) {
        socket.join(getExecutionRoom(executionId));
        socket.emit('subscribed', { executionId });
      }
      } catch (error) {
        console.error(`[WS Marketplace] Subscribe error:`, error);
      }
    });

    socket.on('unsubscribe:execution', (executionId: string) => {
      socket.leave(getExecutionRoom(executionId));
    });
  });
}

// ======================
// EMIT FUNCTIONS
// ======================

let ioInstance: Server | null = null;

export function setIOInstance(io: Server): void {
  ioInstance = io;
}

function getMarketplaceNamespace() {
  if (!ioInstance) {
    console.warn('[WS Marketplace] IO instance not set');
    return null;
  }
  return ioInstance.of('/marketplace');
}

/**
 * Emit POW request to student
 */
export function emitPOWRequest(studentId: string, data: {
  executionId: string;
  powLogId: string;
  timeoutMinutes: number;
}): void {
  const ns = getMarketplaceNamespace();
  if (ns) {
    ns.to(getStudentRoom(studentId)).emit(MARKETPLACE_EVENTS.POW_REQUEST, data);
  }
}

/**
 * Emit POW verification result
 */
export function emitPOWResult(studentId: string, executionId: string, data: {
  powLogId: string;
  status: 'verified' | 'failed';
  message?: string;
}): void {
  const ns = getMarketplaceNamespace();
  if (ns) {
    ns.to(getStudentRoom(studentId)).emit(
      data.status === 'verified' ? MARKETPLACE_EVENTS.POW_VERIFIED : MARKETPLACE_EVENTS.POW_FAILED,
      { executionId, ...data }
    );
    ns.to(getExecutionRoom(executionId)).emit(
      data.status === 'verified' ? MARKETPLACE_EVENTS.POW_VERIFIED : MARKETPLACE_EVENTS.POW_FAILED,
      { executionId, ...data }
    );
  }
}

/**
 * Emit task status change
 */
export function emitTaskStatusChange(
  studentId: string,
  companyId: string,
  executionId: string,
  status: string,
  data: Record<string, any> = {}
): void {
  const ns = getMarketplaceNamespace();
  if (!ns) return;

  const eventMap: Record<string, string> = {
    accepted: MARKETPLACE_EVENTS.TASK_ASSIGNED,
    clocked_in: MARKETPLACE_EVENTS.TASK_STARTED,
    submitted: MARKETPLACE_EVENTS.TASK_SUBMITTED,
    approved: MARKETPLACE_EVENTS.TASK_APPROVED,
    revision_needed: MARKETPLACE_EVENTS.TASK_REVISION,
    failed: MARKETPLACE_EVENTS.TASK_FAILED,
  };

  const event = eventMap[status];
  if (!event) return;

  const payload = { executionId, status, ...data };

  ns.to(getStudentRoom(studentId)).emit(event, payload);
  ns.to(getCompanyRoom(companyId)).emit(event, payload);
  ns.to(getExecutionRoom(executionId)).emit(event, payload);
}

/**
 * Emit milestone completion
 */
export function emitMilestoneCompleted(
  studentId: string,
  companyId: string,
  executionId: string,
  data: {
    milestoneId: string;
    milestoneIndex: number;
    totalMilestones: number;
  }
): void {
  const ns = getMarketplaceNamespace();
  if (!ns) return;

  const payload = { executionId, ...data };
  ns.to(getStudentRoom(studentId)).emit(MARKETPLACE_EVENTS.MILESTONE_COMPLETED, payload);
  ns.to(getCompanyRoom(companyId)).emit(MARKETPLACE_EVENTS.MILESTONE_COMPLETED, payload);
  ns.to(getExecutionRoom(executionId)).emit(MARKETPLACE_EVENTS.MILESTONE_COMPLETED, payload);
}

/**
 * Emit payout status change
 */
export function emitPayoutStatus(studentId: string, data: {
  payoutId: string;
  status: 'pending' | 'processing' | 'completed';
  amountInCents: number;
}): void {
  const ns = getMarketplaceNamespace();
  if (!ns) return;

  const eventMap: Record<string, string> = {
    pending: MARKETPLACE_EVENTS.PAYOUT_PENDING,
    processing: MARKETPLACE_EVENTS.PAYOUT_PROCESSING,
    completed: MARKETPLACE_EVENTS.PAYOUT_COMPLETED,
  };

  ns.to(getStudentRoom(studentId)).emit(eventMap[data.status], data);
}

/**
 * Emit warning to student
 */
export function emitWarning(studentId: string, executionId: string, data: {
  type: 'deadline' | 'inactivity' | 'pow';
  level: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}): void {
  const ns = getMarketplaceNamespace();
  if (!ns) return;

  const eventMap: Record<string, string> = {
    deadline: MARKETPLACE_EVENTS.WARNING_DEADLINE,
    inactivity: MARKETPLACE_EVENTS.WARNING_INACTIVITY,
    pow: MARKETPLACE_EVENTS.WARNING_POW,
  };

  ns.to(getStudentRoom(studentId)).emit(eventMap[data.type], { executionId, ...data });
}

/**
 * Emit coaching message to student
 */
export function emitCoachingMessage(studentId: string, data: {
  trigger: string;
  severity: string;
  message: string;
  tips: string[];
}): void {
  const ns = getMarketplaceNamespace();
  if (ns) {
    ns.to(getStudentRoom(studentId)).emit(MARKETPLACE_EVENTS.COACHING_MESSAGE, data);
  }
}
