/**
 * Defect Analysis Worker
 * 
 * Analyzes failed or revised executions to identify root causes:
 * - Task clarity issues
 * - Student-task mismatch
 * - Unrealistic deadlines
 * - POW compliance gaps
 * 
 * Generates weekly reports and improvement suggestions
 */

import { Worker, Job } from 'bullmq';
import { db } from '@figwork/db';
import { getBullMQRedis } from '../lib/redis.js';
import { notificationQueue } from '../lib/queues.js';
import { getOpenAIClient } from '@figwork/ai';
import { checkClarity, ClarityResult } from '../lib/clarity-checker.js';
import { calculateMatch } from '../lib/task-matcher.js';
import { QUEUE_NAMES } from '@figwork/shared';

interface DefectAnalysisJob {
  executionId: string;
  trigger: 'failed' | 'revision' | 'disputed';
}

interface DefectAnalysisResult {
  defectType: string;
  rootCause: string;
  preventable: boolean;
  taskClarityScore: number | null;
  studentMatchScore: number | null;
  deadlineReasonable: boolean | null;
  powCompliance: number | null;
  resolution: string;
  recommendations: string[];
}

const DEFECT_TYPES = {
  TASK_CLARITY: 'task_clarity',
  SKILL_MISMATCH: 'skill_mismatch',
  DEADLINE_PRESSURE: 'deadline_pressure',
  POW_FRAUD: 'pow_fraud',
  QUALITY_LAPSE: 'quality_lapse',
  COMMUNICATION: 'communication',
  EXTERNAL_FACTOR: 'external_factor',
  UNKNOWN: 'unknown',
} as const;

const ROOT_CAUSES = {
  VAGUE_SPEC: 'vague_specification',
  MISSING_CRITERIA: 'missing_acceptance_criteria',
  WRONG_TIER: 'student_tier_mismatch',
  MISSING_SKILLS: 'missing_required_skills',
  TOO_SHORT: 'deadline_too_short',
  OVERCOMMITTED: 'student_overcommitted',
  POW_MISSED: 'pow_requirements_missed',
  POW_REJECTED: 'pow_submissions_rejected',
  REVISION_LOOP: 'repeated_revision_issues',
  NO_PROGRESS_UPDATES: 'lack_of_communication',
  PERSONAL_ISSUE: 'student_personal_issue',
  SCOPE_CREEP: 'scope_changed_midway',
} as const;

/**
 * Analyze a failed/revised execution for root cause
 */
async function analyzeDefect(executionId: string, trigger: string): Promise<DefectAnalysisResult> {
  const execution = await db.execution.findUnique({
    where: { id: executionId },
    include: {
      workUnit: {
        include: {
          milestoneTemplates: true,
        },
      },
      student: true,
      powLogs: true,
      revisionRequests: true,
      milestones: true,
    },
  });

  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }

  const workUnit = execution.workUnit;
  const student = execution.student;

  // 1. Analyze task clarity
  let clarityScore: number | null = null;
  let clarityResult: ClarityResult | null = null;
  try {
    // Convert acceptanceCriteria from JSON to string array
    const acceptanceCriteria = Array.isArray(workUnit.acceptanceCriteria)
      ? (workUnit.acceptanceCriteria as string[])
      : typeof workUnit.acceptanceCriteria === 'object' && workUnit.acceptanceCriteria
        ? Object.values(workUnit.acceptanceCriteria as Record<string, string>)
        : [];

    clarityResult = await checkClarity({
      title: workUnit.title,
      spec: workUnit.spec,
      acceptanceCriteria: acceptanceCriteria as string[],
      priceInCents: workUnit.priceInCents,
      deadlineHours: workUnit.deadlineHours,
      category: workUnit.category,
    });
    clarityScore = clarityResult.overallScore;
  } catch (e) {
    console.error('Failed to analyze clarity:', e);
  }

  // 2. Analyze student-task match
  let matchScore: number | null = null;
  try {
    const matchResult = await calculateMatch(
      {
        id: student.id,
        tier: student.tier,
        skillTags: student.skillTags || [],
        tasksCompleted: student.tasksCompleted,
        avgQualityScore: student.avgQualityScore,
        revisionRate: student.revisionRate,
        onTimeRate: student.onTimeRate,
        recentFailures: student.recentFailures,
      },
      {
        id: workUnit.id,
        category: workUnit.category,
        requiredSkills: workUnit.requiredSkills || [],
        minTier: workUnit.minTier,
        priceInCents: workUnit.priceInCents,
      }
    );
    matchScore = matchResult.score;
  } catch (e) {
    console.error('Failed to calculate match:', e);
  }

  // 3. Analyze deadline reasonableness
  const actualHoursWorked = execution.clockedInAt && execution.submittedAt
    ? (new Date(execution.submittedAt).getTime() - new Date(execution.clockedInAt).getTime()) / (1000 * 60 * 60)
    : null;
  const deadlineReasonable = actualHoursWorked !== null
    ? actualHoursWorked <= workUnit.deadlineHours * 1.2 // 20% buffer
    : null;

  // 4. Analyze POW compliance
  const totalPOWs = execution.powLogs.length;
  const verifiedPOWs = execution.powLogs.filter(p => p.status === 'verified').length;
  const powCompliance = totalPOWs > 0 ? verifiedPOWs / totalPOWs : null;

  // 5. Determine defect type and root cause using AI
  const aiAnalysis = await determineRootCause(execution, {
    clarityScore,
    matchScore,
    deadlineReasonable,
    powCompliance,
    trigger,
  });

  // Create defect analysis record
  await db.defectAnalysis.create({
    data: {
      executionId,
      workUnitId: workUnit.id,
      defectType: aiAnalysis.defectType,
      rootCause: aiAnalysis.rootCause,
      preventable: aiAnalysis.preventable,
      taskClarityScore: clarityScore,
      studentMatchScore: matchScore,
      deadlineReasonable,
      powCompliance,
      resolution: trigger,
      specImprovements: aiAnalysis.recommendations.filter(r => r.includes('spec') || r.includes('task') || r.includes('clarity')),
      processImprovements: aiAnalysis.recommendations.filter(r => !r.includes('spec') && !r.includes('task') && !r.includes('clarity')),
      analyzedBy: 'system',
    },
  });

  return {
    defectType: aiAnalysis.defectType,
    rootCause: aiAnalysis.rootCause,
    preventable: aiAnalysis.preventable,
    taskClarityScore: clarityScore,
    studentMatchScore: matchScore,
    deadlineReasonable,
    powCompliance,
    resolution: trigger,
    recommendations: aiAnalysis.recommendations,
  };
}

/**
 * Use AI to determine root cause from execution data
 */
async function determineRootCause(
  execution: any,
  metrics: {
    clarityScore: number | null;
    matchScore: number | null;
    deadlineReasonable: boolean | null;
    powCompliance: number | null;
    trigger: string;
  }
): Promise<{
  defectType: string;
  rootCause: string;
  preventable: boolean;
  recommendations: string[];
}> {
  const openai = getOpenAIClient();

  const revisionIssues = execution.revisionRequests?.map((r: any) => r.overallFeedback).join('\n') || 'None';
  const milestoneProgress = execution.milestones?.length > 0
    ? `${execution.milestones.filter((m: any) => m.completedAt).length}/${execution.milestones.length} completed`
    : 'No milestones';

  const prompt = `Analyze this failed/revised task execution and determine the root cause:

TASK:
- Title: ${execution.workUnit.title}
- Category: ${execution.workUnit.category}
- Price: $${(execution.workUnit.priceInCents / 100).toFixed(2)}
- Deadline: ${execution.workUnit.deadlineHours} hours

STUDENT:
- Tier: ${execution.student.tier}
- Tasks Completed: ${execution.student.tasksCompleted}
- Quality Score: ${Math.round(execution.student.avgQualityScore * 100)}%
- Revision Rate: ${Math.round(execution.student.revisionRate * 100)}%

METRICS:
- Task Clarity Score: ${metrics.clarityScore !== null ? Math.round(metrics.clarityScore) : 'N/A'}/100
- Student-Task Match: ${metrics.matchScore !== null ? metrics.matchScore : 'N/A'}/100
- Deadline Reasonable: ${metrics.deadlineReasonable ?? 'Unknown'}
- POW Compliance: ${metrics.powCompliance !== null ? Math.round(metrics.powCompliance * 100) + '%' : 'N/A'}

TRIGGER: ${metrics.trigger}
MILESTONE PROGRESS: ${milestoneProgress}
REVISION FEEDBACK:
${revisionIssues}

Respond in JSON format:
{
  "defectType": "one of: task_clarity, skill_mismatch, deadline_pressure, pow_fraud, quality_lapse, communication, external_factor, unknown",
  "rootCause": "brief description of root cause",
  "preventable": true/false,
  "recommendations": ["improvement 1", "improvement 2"]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-5.2',
    messages: [
      {
        role: 'system',
        content: 'You are a quality analyst for a gig marketplace. Analyze task failures to identify root causes and suggest improvements. Always respond with valid JSON.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 500,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || '';

  try {
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Failed to parse AI response:', e);
  }

  // Default response if AI fails
  return {
    defectType: DEFECT_TYPES.UNKNOWN,
    rootCause: 'Unable to determine root cause',
    preventable: false,
    recommendations: ['Review execution details manually'],
  };
}

/**
 * Generate weekly defect report for a company
 */
export async function generateWeeklyReport(companyId: string): Promise<{
  periodStart: Date;
  periodEnd: Date;
  totalExecutions: number;
  totalDefects: number;
  defectRate: number;
  defectsByType: Record<string, number>;
  topRootCauses: Array<{ cause: string; count: number }>;
  recommendations: string[];
}> {
  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - 7);

  // Get all executions for the period
  const executions = await db.execution.findMany({
    where: {
      workUnit: { companyId },
      assignedAt: { gte: periodStart },
    },
    include: {
      defectAnalysis: true,
    },
  });

  const totalExecutions = executions.length;
  const defects = executions.filter(e => e.defectAnalysis);
  const totalDefects = defects.length;
  const defectRate = totalExecutions > 0 ? totalDefects / totalExecutions : 0;

  // Group by defect type
  const defectsByType: Record<string, number> = {};
  const rootCauseCounts: Record<string, number> = {};

  for (const exec of defects) {
    if (exec.defectAnalysis) {
      const type = exec.defectAnalysis.defectType;
      const cause = exec.defectAnalysis.rootCause;
      defectsByType[type] = (defectsByType[type] || 0) + 1;
      rootCauseCounts[cause] = (rootCauseCounts[cause] || 0) + 1;
    }
  }

  // Top root causes
  const topRootCauses = Object.entries(rootCauseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cause, count]) => ({ cause, count }));

  // Generate recommendations based on patterns
  const recommendations: string[] = [];

  if (defectsByType[DEFECT_TYPES.TASK_CLARITY] > totalDefects * 0.3) {
    recommendations.push('High task clarity issues - Consider using the clarity checker before publishing tasks');
  }
  if (defectsByType[DEFECT_TYPES.SKILL_MISMATCH] > totalDefects * 0.3) {
    recommendations.push('Frequent skill mismatches - Review required skills and consider tier requirements');
  }
  if (defectsByType[DEFECT_TYPES.DEADLINE_PRESSURE] > totalDefects * 0.3) {
    recommendations.push('Deadline issues common - Consider extending deadlines or reducing scope');
  }
  if (defectRate > 0.2) {
    recommendations.push('Overall defect rate is high (>20%) - Review task specifications and matching criteria');
  }
  if (recommendations.length === 0 && totalDefects > 0) {
    recommendations.push('Monitor trends and address individual issues as they arise');
  }

  return {
    periodStart,
    periodEnd,
    totalExecutions,
    totalDefects,
    defectRate,
    defectsByType,
    topRootCauses,
    recommendations,
  };
}

/**
 * Send weekly reports to all companies
 */
export async function sendWeeklyReports(): Promise<{
  companiesSent: number;
  errors: string[];
}> {
  const companies = await db.companyProfile.findMany({
    where: {
      verificationStatus: 'verified',
    },
    select: { id: true, companyName: true, userId: true },
  });

  let companiesSent = 0;
  const errors: string[] = [];

  for (const company of companies) {
    try {
      const report = await generateWeeklyReport(company.id);

      if (report.totalExecutions === 0) {
        continue; // Skip companies with no activity
      }

      await notificationQueue.add('send', {
        userId: company.userId,
        userType: 'company',
        type: 'weekly_report',
        title: '📊 Weekly Quality Report',
        body: `${report.totalExecutions} tasks, ${report.totalDefects} issues (${Math.round(report.defectRate * 100)}% defect rate)`,
        channels: ['in_app', 'email'],
        data: {
          report,
          companyId: company.id,
        },
      });

      companiesSent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      errors.push(`Company ${company.id}: ${message}`);
    }
  }

  return { companiesSent, errors };
}

/**
 * Process defect analysis job
 */
async function processDefectAnalysis(job: Job<DefectAnalysisJob>) {
  const { executionId, trigger } = job.data;

  console.log(`[Defect] Analyzing execution ${executionId}, trigger: ${trigger}`);

  try {
    const result = await analyzeDefect(executionId, trigger);
    console.log(`[Defect] Analysis complete: ${result.defectType} - ${result.rootCause}`);
    return result;
  } catch (error) {
    console.error(`[Defect] Analysis failed:`, error);
    throw error;
  }
}

// Create worker
const worker = new Worker<DefectAnalysisJob>(
  QUEUE_NAMES.DEFECT_ANALYSIS,
  processDefectAnalysis,
  {
    connection: getBullMQRedis(),
    concurrency: 3,
  }
);

worker.on('completed', (job) => {
  console.log(`[Defect Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[Defect Worker] Job ${job?.id} failed:`, error);
});

export function startDefectAnalysisWorker() {
  console.log('[Defect Analysis Worker] Started');
}

export { worker as defectAnalysisWorker };
