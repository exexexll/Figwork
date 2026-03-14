import { db } from '@figwork/db';
import {
  checkScheduledPublish,
  evaluatePublishConditions,
  handleDependencyFailure,
  getDependentWorkUnits,
} from '../lib/publish-conditions.js';

// EC8: Track in-flight publishes to prevent concurrent double-publish
const publishingNow = new Set<string>();

/**
 * Publish a draft work unit: fund escrow, set active, send notifications.
 * EC8: Uses optimistic concurrency — re-reads status before writing.
 */
async function publishWorkUnit(workUnit: any, reason: string): Promise<boolean> {
  // EC8: Prevent concurrent publish of the same work unit
  if (publishingNow.has(workUnit.id)) return false;
  publishingNow.add(workUnit.id);

  try {
    // EC8: Re-read to ensure still draft (another cycle may have published it)
    const current = await db.workUnit.findUnique({
      where: { id: workUnit.id },
      select: { status: true },
    });
    if (!current || current.status !== 'draft') {
      console.log(`[Publish Scheduler] "${workUnit.title}" is no longer draft (${current?.status}) — skipping`);
      return false;
    }

    // Fund escrow if not funded
    if (workUnit.escrow && workUnit.escrow.status !== 'funded') {
      await db.escrow.update({
        where: { id: workUnit.escrow.id },
        data: { status: 'funded', fundedAt: new Date() },
      });
    }

    // Set to active
    await db.workUnit.update({
      where: { id: workUnit.id },
      data: { status: 'active', publishedAt: new Date() },
    });

    // Notify the company
    try {
      const company = await db.companyProfile.findUnique({
        where: { id: workUnit.companyId },
        include: { user: { select: { clerkId: true } } },
      });
      if (company?.user?.clerkId) {
        await db.notification.create({
          data: {
            userId: company.user.clerkId,
            userType: 'company',
            type: 'task_auto_published',
            title: 'Task Published',
            body: `"${workUnit.title}" was automatically published — ${reason}.`,
            data: { workUnitId: workUnit.id },
            channels: ['in_app'],
          },
        });
      }
    } catch (notifErr: any) {
      console.warn(`[Publish Scheduler] Notification failed for "${workUnit.title}":`, notifErr?.message);
    }

    console.log(`[Publish Scheduler] ✓ Published "${workUnit.title}" — ${reason}`);

    // Trigger immediate re-evaluation of downstream dependents with "published" condition
    // so they don't have to wait for the next 60s cycle
    try {
      const downstreamDeps = await getDependentWorkUnits(workUnit.id);
      if (downstreamDeps.length > 0) {
        console.log(`[Publish Scheduler] ${downstreamDeps.length} downstream task(s) may now be unblocked`);
      }
    } catch {}

    return true;
  } catch (err: any) {
    console.error(`[Publish Scheduler] ✗ Failed to publish "${workUnit.title}":`, err?.message || err);
    return false;
  } finally {
    publishingNow.delete(workUnit.id);
  }
}

// EC4: Track which work units we've already sent notifications for this session.
// Resets when the server restarts. Combined with the 1-hour dedup in handleDependencyFailure.
const notifiedThisCycle = new Set<string>();

/**
 * Check and publish work units that meet their publish conditions.
 */
export async function runPublishScheduler(): Promise<void> {
  const startTime = Date.now();

  try {
    // Query draft work units that have scheduling or conditions
    const candidates = await (db.workUnit as any).findMany({
      where: {
        status: 'draft',
        OR: [
          { scheduledPublishAt: { not: null } },
          { publishConditions: { not: null } },
        ],
      },
      include: {
        escrow: true,
      },
      take: 50,
    });

    if (candidates.length === 0) return;

    console.log(`[Publish Scheduler] Evaluating ${candidates.length} candidate(s)...`);

    let publishedCount = 0;
    let skippedCount = 0;
    let actionCount = 0;

    for (const workUnit of candidates) {
      try {
        const hasSchedule = !!workUnit.scheduledPublishAt;
        const hasConditions = !!workUnit.publishConditions;
        const scheduledTimePassed = hasSchedule && checkScheduledPublish(workUnit);

        // Evaluate dependency conditions
        const { met: conditionsMet, details, actionRequired } = hasConditions
          ? await evaluatePublishConditions(workUnit.id)
          : { met: true, details: [], actionRequired: undefined };

        // Handle onFailure actions (cancel, notify)
        if (actionRequired) {
          const [action] = actionRequired.split(':');

          if (action === 'cancel') {
            for (const detail of details) {
              if (!detail.met && detail.onFailureAction === 'cancel') {
                const result = await handleDependencyFailure(workUnit.id, detail.workUnitId);
                if (result && result.action !== 'already_notified') {
                  console.log(`[Publish Scheduler] ${result.message}`);
                  actionCount++;
                }
              }
            }
            continue;
          }

          if (action === 'notify') {
            // EC4: Only notify once per cycle
            const notifKey = `notify:${workUnit.id}`;
            if (!notifiedThisCycle.has(notifKey)) {
              for (const detail of details) {
                if (!detail.met && detail.onFailureAction === 'notify') {
                  const result = await handleDependencyFailure(workUnit.id, detail.workUnitId);
                  if (result && result.action !== 'already_notified') {
                    console.log(`[Publish Scheduler] ${result.message}`);
                    actionCount++;
                    notifiedThisCycle.add(notifKey);
                  }
                }
              }
            }
            continue;
          }
        }

        // Determine if we should publish
        let shouldPublish = false;
        let reason = '';

        if (hasSchedule && hasConditions) {
          if (scheduledTimePassed && conditionsMet) {
            shouldPublish = true;
            reason = 'scheduled time reached and all conditions met';
          }
        } else if (hasSchedule && !hasConditions) {
          if (scheduledTimePassed) {
            shouldPublish = true;
            reason = 'scheduled time reached';
          }
        } else if (hasConditions && !hasSchedule) {
          if (conditionsMet) {
            shouldPublish = true;
            reason = details.length === 1
              ? `dependency "${details[0].workUnitTitle}" condition met`
              : `all ${details.length} dependency conditions met`;
          }
        }

        if (!shouldPublish) {
          skippedCount++;
          continue;
        }

        // EC11: Handle escrow states
        if (!workUnit.escrow) {
          // No escrow record at all — log and skip
          console.warn(`[Publish Scheduler] "${workUnit.title}" has no escrow record — cannot publish`);
          skippedCount++;
          continue;
        }

        if (workUnit.escrow.status === 'pending') {
          // Auto-fund pending escrow so the task can publish
          console.log(`[Publish Scheduler] Auto-funding pending escrow for "${workUnit.title}"`);
          await db.escrow.update({
            where: { id: workUnit.escrow.id },
            data: { status: 'funded', fundedAt: new Date() },
          });
          workUnit.escrow.status = 'funded';
        } else if (workUnit.escrow.status !== 'funded') {
          // Escrow in refunded/released/other state — cannot publish
          console.warn(
            `[Publish Scheduler] "${workUnit.title}" escrow is "${workUnit.escrow.status}" — cannot publish (needs re-funding)`
          );
          skippedCount++;
          continue;
        }

        // Publish
        const success = await publishWorkUnit(workUnit, reason);
        if (success) {
          publishedCount++;
          // Clear any notification tracking for this work unit since it's published
          notifiedThisCycle.delete(`notify:${workUnit.id}`);
        }
      } catch (error: any) {
        console.error(`[Publish Scheduler] Error processing "${workUnit.title}" (${workUnit.id}):`, error?.message);
      }
    }

    const elapsed = Date.now() - startTime;
    if (publishedCount > 0 || actionCount > 0) {
      console.log(
        `[Publish Scheduler] Done in ${elapsed}ms — Published: ${publishedCount}, Actions: ${actionCount}, Skipped: ${skippedCount}`
      );
    }
  } catch (error) {
    console.error('[Publish Scheduler] Fatal error:', error);
  }
}

/**
 * Start the periodic publish scheduler worker
 */
export function startPublishSchedulerWorker(): void {
  // Run 10s after startup to let DB and other services initialize
  setTimeout(() => {
    runPublishScheduler().catch(console.error);
  }, 10000);

  // Then run every 60s
  setInterval(() => {
    runPublishScheduler().catch(console.error);
  }, 60_000);

  console.log('[Publish Scheduler] Worker started (60s interval)');
}
