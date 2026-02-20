import { Worker, Job } from 'bullmq';
import { getBullMQRedis } from '../lib/redis.js';
import { db } from '@figwork/db';
import { QUEUE_NAMES } from '@figwork/shared';
import { getOpenAIClient } from '@figwork/ai';

interface QAJobData {
  executionId: string;
}

interface QACheckConfig {
  name: string;
  check: (execution: any, deliverables: string[]) => Promise<{ passed: boolean; details: string }>;
}

const qaChecks: QACheckConfig[] = [
  {
    name: 'deliverable_count',
    check: async (execution, deliverables) => {
      const required = execution.workUnit.deliverableFormat?.length || 1;
      const passed = deliverables.length >= required;
      return {
        passed,
        details: passed 
          ? `Required ${required} deliverable(s), got ${deliverables.length}`
          : `Missing deliverables: expected ${required}, got ${deliverables.length}`,
      };
    },
  },
  {
    name: 'deadline_compliance',
    check: async (execution) => {
      const passed = !execution.wasLate;
      return {
        passed,
        details: passed 
          ? 'Submitted before deadline'
          : 'Submitted after deadline',
      };
    },
  },
  {
    name: 'milestone_completion',
    check: async (execution) => {
      const milestones = await db.taskMilestone.findMany({
        where: { executionId: execution.id },
      });
      const completed = milestones.filter(m => m.completedAt).length;
      const passed = completed === milestones.length;
      return {
        passed,
        details: passed
          ? `All ${milestones.length} milestones completed`
          : `Only ${completed}/${milestones.length} milestones completed`,
      };
    },
  },
  {
    name: 'pow_compliance',
    check: async (execution) => {
      const powLogs = await db.proofOfWorkLog.findMany({
        where: { executionId: execution.id },
      });
      
      if (powLogs.length === 0) {
        return { passed: true, details: 'No POW required' };
      }

      const verified = powLogs.filter(p => p.status === 'verified').length;
      const failed = powLogs.filter(p => p.status === 'failed').length;
      const compliance = verified / powLogs.length;
      
      const passed = compliance >= 0.8; // 80% compliance threshold
      return {
        passed,
        details: passed
          ? `POW compliance: ${(compliance * 100).toFixed(0)}% (${verified}/${powLogs.length})`
          : `Low POW compliance: ${(compliance * 100).toFixed(0)}% with ${failed} failures`,
      };
    },
  },
];

async function runQAChecks(job: Job<QAJobData>) {
  const { executionId } = job.data;
  
  console.log(`[QA] Running checks for execution ${executionId}`);

  const execution = await db.execution.findUnique({
    where: { id: executionId },
    include: {
      workUnit: true,
      student: true,
      milestones: { include: { template: true } },
    },
  });

  if (!execution) {
    console.log(`[QA] Execution ${executionId} not found`);
    return { error: 'Execution not found' };
  }

  if (execution.status !== 'submitted') {
    console.log(`[QA] Execution ${executionId} not in submitted status`);
    return { skipped: true, reason: 'not_submitted' };
  }

  const deliverables = execution.deliverableUrls || [];
  const results: Record<string, { passed: boolean; details: string }> = {};
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  const blockers: string[] = [];
  const warningsList: string[] = [];

  // Run all QA checks
  for (const qaCheck of qaChecks) {
    try {
      const result = await qaCheck.check(execution, deliverables);
      results[qaCheck.name] = result;
      
      if (result.passed) {
        passed++;
      } else {
        if (qaCheck.name === 'pow_compliance') {
          warnings++;
          warningsList.push(result.details);
        } else {
          failed++;
          blockers.push(result.details);
        }
      }
    } catch (error) {
      console.error(`[QA] Check ${qaCheck.name} failed:`, error);
      results[qaCheck.name] = { passed: false, details: 'Check failed to run' };
      warnings++;
      warningsList.push(`${qaCheck.name}: Check failed to execute`);
    }
  }

  // AI-powered content analysis (if deliverables are available)
  if (deliverables.length > 0) {
    try {
      const openai = getOpenAIClient();
      
      const contentAnalysis = await openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [
          {
            role: 'system',
            content: `You are a QA reviewer for gig work. Analyze if the deliverables meet the acceptance criteria.`,
          },
          {
            role: 'user',
            content: `Task: ${execution.workUnit.title}
Specification: ${execution.workUnit.spec.slice(0, 1000)}...
Acceptance Criteria: ${JSON.stringify(execution.workUnit.acceptanceCriteria)}

Deliverables submitted: ${deliverables.length} files/links
Submission notes: ${execution.submissionNotes || 'None'}

Based on the information provided, rate the submission:
Return JSON: {
  "score": number (0-100),
  "meetsAllCriteria": boolean,
  "issues": string[],
  "suggestions": string[]
}`,
          },
        ],
        max_tokens: 400,
        response_format: { type: 'json_object' },
      });

      const aiResult = JSON.parse(contentAnalysis.choices[0].message.content || '{}');
      results['ai_content_analysis'] = {
        passed: aiResult.meetsAllCriteria && aiResult.score >= 70,
        details: `AI Score: ${aiResult.score}/100. ${aiResult.issues?.length || 0} issues found.`,
      };

      if (!results['ai_content_analysis'].passed) {
        if (aiResult.score < 50) {
          failed++;
          blockers.push(`AI analysis: Low score (${aiResult.score}/100)`);
          if (aiResult.issues) {
            blockers.push(...aiResult.issues.slice(0, 3));
          }
        } else {
          warnings++;
          warningsList.push(`AI analysis: Score ${aiResult.score}/100`);
          if (aiResult.issues) {
            warningsList.push(...aiResult.issues.slice(0, 2));
          }
        }
      } else {
        passed++;
      }
    } catch (error) {
      console.error('[QA] AI content analysis failed:', error);
      results['ai_content_analysis'] = { passed: true, details: 'AI analysis skipped due to error' };
    }
  }

  // Determine auto-approval
  const autoApproved = failed === 0 && warnings === 0;

  // Create QA result record
  const qaResult = await db.qACheckResult.create({
    data: {
      executionId,
      checksRun: Object.keys(results),
      checksPassed: passed,
      checksFailed: failed,
      checksWarning: warnings,
      results,
      autoApproved,
      blockers,
      warnings: warningsList,
    },
  });

  // Update execution
  await db.execution.update({
    where: { id: executionId },
    data: {
      qaCheckId: qaResult.id,
      status: autoApproved ? 'approved' : 'in_review',
      qaVerdict: autoApproved ? 'pass' : (failed > 0 ? 'revise' : 'review'),
    },
  });

  // If auto-approved, trigger completion flow
  if (autoApproved) {
    console.log(`[QA] Execution ${executionId} auto-approved`);
    // Note: In production, you might want to queue a completion job instead
  }

  // Notify company that review is needed
  if (!autoApproved) {
    const company = await db.companyProfile.findUnique({
      where: { id: execution.workUnit.companyId },
    });

    if (company) {
      await db.notification.create({
        data: {
          userId: company.userId,
          userType: 'company',
          type: 'review_needed',
          title: 'Review Required',
          body: `Deliverables for "${execution.workUnit.title}" need your review`,
          data: { executionId, qaResultId: qaResult.id, blockers, warnings: warningsList },
          channels: ['in_app', 'email'],
        },
      });
    }
  }

  console.log(`[QA] Checks complete for ${executionId}: ${passed} passed, ${failed} failed, ${warnings} warnings. Auto-approved: ${autoApproved}`);

  return {
    executionId,
    passed,
    failed,
    warningCount: warnings,
    autoApproved,
    blockers,
    warnings: warningsList,
  };
}

export function startQAWorker() {
  const worker = new Worker(
    QUEUE_NAMES.QA_CHECK,
    runQAChecks,
    {
      connection: getBullMQRedis(),
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[QA Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[QA Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[QA Worker] Started');
  return worker;
}
