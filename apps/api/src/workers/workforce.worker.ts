import { db } from '@figwork/db';
import { getDependentWorkUnits } from '../lib/publish-conditions.js';

/**
 * Workforce Management Worker
 * Runs every 5 minutes to handle:
 * 1. Auto-reassignment of timed-out/failed executions
 * 2. Deadline alert notifications (24h and 4h)
 * 3. Bottleneck detection in dependency chains
 * 4. Auto-escalation for severely overdue tasks
 */

const ALERTED_24H = new Set<string>();
const ALERTED_4H = new Set<string>();
const ESCALATED = new Set<string>();

export async function runWorkforceCheck(): Promise<void> {
  const now = new Date();

  try {
    // ═══════════════════════════════════════════════════
    // 1. AUTO-REASSIGNMENT: Failed/timed-out executions
    // ═══════════════════════════════════════════════════

    // Find executions that are overdue by >48h with no activity (likely abandoned)
    const abandonedCutoff = new Date(now.getTime() - 48 * 3600000);
    const abandonedExecs = await db.execution.findMany({
      where: {
        status: { in: ['assigned', 'clocked_in'] },
        deadlineAt: { lt: abandonedCutoff },
      },
      include: {
        workUnit: { select: { id: true, title: true, status: true, companyId: true, assignmentMode: true } },
        student: { select: { id: true, name: true, clerkId: true } },
      },
      take: 20,
    });

    for (const exec of abandonedExecs) {
      try {
        // Only auto-reassign for auto-assignment mode work units
        if (exec.workUnit.assignmentMode !== 'auto') continue;
        if (exec.workUnit.status !== 'active') continue;

        // Cancel the abandoned execution
        await db.execution.update({
          where: { id: exec.id },
          data: { status: 'failed', completedAt: now, qaVerdict: 'fail' },
        });

        // Update student stats
        await db.studentProfile.update({
          where: { id: exec.studentId },
          data: {
            recentFailures: { increment: 1 },
            lastFailureAt: now,
          },
        });

        // Notify company
        try {
          const company = await db.companyProfile.findUnique({
            where: { id: exec.workUnit.companyId },
            include: { user: { select: { clerkId: true } } },
          });
          if (company?.user?.clerkId) {
            await db.notification.create({
              data: {
                userId: company.user.clerkId,
                userType: 'company',
                type: 'auto_reassignment',
                title: 'Task Auto-Reassigned',
                body: `"${exec.workUnit.title}" was abandoned by ${exec.student.name} (48h+ overdue). The task is now available for a new contractor.`,
                data: { executionId: exec.id, workUnitId: exec.workUnit.id },
                channels: ['in_app'],
              },
            });
          }
        } catch {}

        // Notify the student
        try {
          await db.notification.create({
            data: {
              userId: exec.student.clerkId,
              userType: 'student',
              type: 'execution_cancelled',
              title: 'Task Removed',
              body: `"${exec.workUnit.title}" was reassigned because the deadline passed without activity.`,
              data: { executionId: exec.id },
              channels: ['in_app'],
            },
          });
        } catch {}

        console.log(`[Workforce] Auto-reassigned "${exec.workUnit.title}" — ${exec.student.name} was 48h+ overdue`);
      } catch (err: any) {
        console.error(`[Workforce] Failed to reassign execution ${exec.id}:`, err?.message);
      }
    }

    // ═══════════════════════════════════════════════════
    // 2. DEADLINE ALERTS: 24h and 4h warnings
    // ═══════════════════════════════════════════════════

    const in24h = new Date(now.getTime() + 24 * 3600000);
    const in4h = new Date(now.getTime() + 4 * 3600000);

    const approachingExecs = await db.execution.findMany({
      where: {
        status: { in: ['assigned', 'clocked_in', 'revision_needed'] },
        deadlineAt: { gt: now, lt: in24h },
      },
      include: {
        workUnit: { select: { title: true, companyId: true } },
        student: { select: { name: true, clerkId: true } },
      },
      take: 50,
    });

    for (const exec of approachingExecs) {
      const hoursLeft = Math.round((new Date(exec.deadlineAt).getTime() - now.getTime()) / 3600000);

      // 4h alert
      if (hoursLeft <= 4 && !ALERTED_4H.has(exec.id)) {
        ALERTED_4H.add(exec.id);
        try {
          await db.notification.create({
            data: {
              userId: exec.student.clerkId,
              userType: 'student',
              type: 'deadline_warning',
              title: 'Deadline in 4 Hours',
              body: `"${exec.workUnit.title}" is due in ${hoursLeft}h. Submit your deliverables soon.`,
              data: { executionId: exec.id },
              channels: ['in_app', 'sms'],
            },
          });
        } catch {}
      }
      // 24h alert
      else if (hoursLeft <= 24 && hoursLeft > 4 && !ALERTED_24H.has(exec.id)) {
        ALERTED_24H.add(exec.id);
        try {
          await db.notification.create({
            data: {
              userId: exec.student.clerkId,
              userType: 'student',
              type: 'deadline_warning',
              title: 'Deadline Tomorrow',
              body: `"${exec.workUnit.title}" is due in ${hoursLeft}h.`,
              data: { executionId: exec.id },
              channels: ['in_app'],
            },
          });
        } catch {}
      }
    }

    // ═══════════════════════════════════════════════════
    // 3. BOTTLENECK DETECTION: Stalled tasks blocking chains
    // ═══════════════════════════════════════════════════

    const overdueExecs = await db.execution.findMany({
      where: {
        status: { in: ['assigned', 'clocked_in'] },
        deadlineAt: { lt: now },
      },
      include: {
        workUnit: { select: { id: true, title: true, companyId: true } },
        student: { select: { name: true } },
      },
      take: 30,
    });

    for (const exec of overdueExecs) {
      try {
        const dependents = await getDependentWorkUnits(exec.workUnit.id);
        if (dependents.length === 0) continue;

        // This task is blocking others — flag as bottleneck
        const hoursOverdue = Math.round((now.getTime() - new Date(exec.deadlineAt).getTime()) / 3600000);
        const bottleneckKey = `bottleneck:${exec.id}`;
        if (ESCALATED.has(bottleneckKey)) continue;

        try {
          const company = await db.companyProfile.findUnique({
            where: { id: exec.workUnit.companyId },
            include: { user: { select: { clerkId: true } } },
          });
          if (company?.user?.clerkId) {
            await db.notification.create({
              data: {
                userId: company.user.clerkId,
                userType: 'company',
                type: 'bottleneck_detected',
                title: 'Bottleneck Detected',
                body: `"${exec.workUnit.title}" is ${hoursOverdue}h overdue and blocking ${dependents.length} downstream task(s): ${dependents.map(d => d.title).join(', ')}.`,
                data: { executionId: exec.id, workUnitId: exec.workUnit.id, dependentCount: dependents.length },
                channels: ['in_app'],
              },
            });
            ESCALATED.add(bottleneckKey);
          }
        } catch {}
      } catch {}
    }

    // ═══════════════════════════════════════════════════
    // 4. AUTO-ESCALATION: 24h+ overdue with no activity
    // ═══════════════════════════════════════════════════

    const escalationCutoff = new Date(now.getTime() - 24 * 3600000);
    const severelyOverdue = await db.execution.findMany({
      where: {
        status: { in: ['assigned', 'clocked_in'] },
        deadlineAt: { lt: escalationCutoff },
      },
      include: {
        workUnit: { select: { id: true, title: true, companyId: true } },
        student: { select: { name: true, id: true } },
      },
      take: 20,
    });

    for (const exec of severelyOverdue) {
      const escalateKey = `escalate:${exec.id}`;
      if (ESCALATED.has(escalateKey)) continue;

      // Check for recent POW activity
      const recentPOW = await db.proofOfWorkLog.findFirst({
        where: {
          executionId: exec.id,
          requestedAt: { gt: escalationCutoff },
        },
      });

      if (recentPOW) continue; // Has recent activity, don't escalate

      const hoursOverdue = Math.round((now.getTime() - new Date(exec.deadlineAt).getTime()) / 3600000);

      try {
        const company = await db.companyProfile.findUnique({
          where: { id: exec.workUnit.companyId },
          include: { user: { select: { clerkId: true } } },
        });
        if (company?.user?.clerkId) {
          await db.notification.create({
            data: {
              userId: company.user.clerkId,
              userType: 'company',
              type: 'auto_escalation',
              title: 'Task Severely Overdue',
              body: `"${exec.workUnit.title}" assigned to ${exec.student.name} is ${hoursOverdue}h overdue with no recent activity. Consider cancelling and reassigning.`,
              data: { executionId: exec.id, workUnitId: exec.workUnit.id, hoursOverdue },
              channels: ['in_app'],
            },
          });
          ESCALATED.add(escalateKey);
        }
      } catch {}
    }

  } catch (error) {
    console.error('[Workforce] Fatal error:', error);
  }
}

export function startWorkforceWorker(): void {
  // Run 30s after startup
  setTimeout(() => {
    runWorkforceCheck().catch(console.error);
  }, 30000);

  // Then every 5 minutes
  setInterval(() => {
    runWorkforceCheck().catch(console.error);
  }, 5 * 60_000);

  console.log('[Workforce] Worker started (5m interval)');
}
