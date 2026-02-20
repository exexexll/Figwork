/**
 * Coaching System - Automated coaching triggers and recommendations
 * 
 * Triggers:
 * 1. Revision pattern - consecutive tasks needing revisions
 * 2. Deadline issues - repeated late submissions
 * 3. POW failures - repeated POW rejections/misses
 * 4. Quality decline - dropping quality scores
 * 5. Communication gaps - lack of progress updates
 */

import { db } from '@figwork/db';
import { notificationQueue } from './queues.js';
import { getOpenAIClient } from '@figwork/ai';

export type CoachingTrigger = 
  | 'revision_pattern'
  | 'deadline_issues'
  | 'pow_failures'
  | 'quality_decline'
  | 'communication_gap';

export interface CoachingRecommendation {
  trigger: CoachingTrigger;
  severity: 'mild' | 'moderate' | 'severe';
  title: string;
  message: string;
  tips: string[];
  resources?: Array<{ title: string; url: string }>;
  restrictionApplied?: string;
}

interface StudentMetrics {
  studentId: string;
  recentRevisions: number;
  consecutiveRevisions: number;
  lateSubmissions: number;
  powFailures: number;
  powMisses: number;
  avgQualityScore: number;
  qualityTrend: 'improving' | 'stable' | 'declining';
  lastProgressUpdate: Date | null;
  tasksCompleted: number;
}

/**
 * Get student's recent metrics for coaching analysis
 */
async function getStudentMetrics(studentId: string): Promise<StudentMetrics> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get student base stats
  const student = await db.studentProfile.findUnique({
    where: { id: studentId },
    select: { avgQualityScore: true, tasksCompleted: true },
  });

  // Get recent executions
  const executions = await db.execution.findMany({
    where: {
      studentId,
      assignedAt: { gte: thirtyDaysAgo },
    },
    include: {
      revisionRequests: true,
    },
    orderBy: { assignedAt: 'desc' },
  });

  // Count revisions
  const recentRevisions = executions.filter(
    (e: typeof executions[number]) => e.revisionRequests.length > 0
  ).length;
  
  // Count consecutive revisions
  let consecutiveRevisions = 0;
  for (const exec of executions) {
    if (exec.revisionRequests.length > 0) {
      consecutiveRevisions++;
    } else {
      break;
    }
  }

  // Count late submissions
  const lateSubmissions = executions.filter(
    (e: typeof executions[number]) => e.wasLate
  ).length;

  // Get POW failures and misses
  const powLogs = await db.proofOfWorkLog.findMany({
    where: {
      studentId,
      requestedAt: { gte: thirtyDaysAgo },
    },
  });

  const powFailures = powLogs.filter((p: typeof powLogs[number]) => p.status === 'rejected').length;
  const powMisses = powLogs.filter((p: typeof powLogs[number]) => p.status === 'missed').length;

  // Calculate quality scores from individual executions
  const qualityScores = executions
    .filter((e: typeof executions[number]) => e.qualityScore !== null)
    .map((e: typeof executions[number]) => e.qualityScore as number);

  const avgQualityScore = qualityScores.length > 0
    ? qualityScores.reduce((a: number, b: number) => a + b, 0) / qualityScores.length
    : (student?.avgQualityScore || 0);

  // Calculate quality trend
  let qualityTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (qualityScores.length >= 4) {
    const recentScores = qualityScores.slice(0, 2);
    const olderScores = qualityScores.slice(2, 4);
    const recentAvg = recentScores.reduce((a: number, b: number) => a + b, 0) / recentScores.length;
    const olderAvg = olderScores.reduce((a: number, b: number) => a + b, 0) / olderScores.length;
    
    if (recentAvg > olderAvg + 0.1) {
      qualityTrend = 'improving';
    } else if (recentAvg < olderAvg - 0.1) {
      qualityTrend = 'declining';
    }
  }

  // Get last progress update (last clock-in or submission)
  const lastProgressUpdate = executions.length > 0
    ? executions[0].clockedInAt || executions[0].assignedAt
    : null;

  return {
    studentId,
    recentRevisions,
    consecutiveRevisions,
    lateSubmissions,
    powFailures,
    powMisses,
    avgQualityScore,
    qualityTrend,
    lastProgressUpdate,
    tasksCompleted: student?.tasksCompleted || 0,
  };
}

/**
 * Check for revision pattern trigger
 */
function checkRevisionPattern(metrics: StudentMetrics): CoachingRecommendation | null {
  if (metrics.consecutiveRevisions < 2) return null;

  let severity: 'mild' | 'moderate' | 'severe';
  let restrictionApplied: string | undefined;

  if (metrics.consecutiveRevisions >= 4) {
    severity = 'severe';
    restrictionApplied = 'New task acceptance paused until revision streak broken';
  } else if (metrics.consecutiveRevisions >= 3) {
    severity = 'moderate';
    restrictionApplied = 'Limited to 1 concurrent task';
  } else {
    severity = 'mild';
  }

  return {
    trigger: 'revision_pattern',
    severity,
    title: 'Revision Pattern Detected',
    message: `Your last ${metrics.consecutiveRevisions} tasks required revisions. Let's work on improving first-time quality.`,
    tips: [
      'Read the full specification before starting work',
      'Review acceptance criteria before submitting',
      'Ask questions if anything is unclear',
      'Double-check your work against requirements',
    ],
    restrictionApplied,
  };
}

/**
 * Check for deadline issues trigger
 */
function checkDeadlineIssues(metrics: StudentMetrics): CoachingRecommendation | null {
  if (metrics.lateSubmissions < 2) return null;

  let severity: 'mild' | 'moderate' | 'severe';
  let restrictionApplied: string | undefined;

  if (metrics.lateSubmissions >= 4) {
    severity = 'severe';
    restrictionApplied = 'Restricted to shorter deadline tasks only';
  } else if (metrics.lateSubmissions >= 3) {
    severity = 'moderate';
  } else {
    severity = 'mild';
  }

  return {
    trigger: 'deadline_issues',
    severity,
    title: 'Deadline Management',
    message: `${metrics.lateSubmissions} recent late submissions. Meeting deadlines is important for client trust.`,
    tips: [
      'Only accept tasks you can complete in time',
      'Break work into milestones and track progress',
      'Communicate early if you need more time',
      'Leave buffer time for unexpected issues',
    ],
    restrictionApplied,
  };
}

/**
 * Check for POW failure trigger
 */
function checkPOWFailures(metrics: StudentMetrics): CoachingRecommendation | null {
  const totalIssues = metrics.powFailures + metrics.powMisses;
  if (totalIssues < 3) return null;

  let severity: 'mild' | 'moderate' | 'severe';
  let restrictionApplied: string | undefined;

  if (totalIssues >= 6 || metrics.powMisses >= 3) {
    severity = 'severe';
    restrictionApplied = 'Under review for POW compliance';
  } else if (totalIssues >= 4) {
    severity = 'moderate';
    restrictionApplied = 'Increased POW frequency';
  } else {
    severity = 'mild';
  }

  return {
    trigger: 'pow_failures',
    severity,
    title: 'Proof of Work Compliance',
    message: `${totalIssues} POW issues in the last 30 days. POW helps verify genuine work.`,
    tips: [
      'Respond to POW requests within the time limit',
      'Take clear photos showing your work and face',
      'Set notifications for POW reminders',
      'Keep your work area well-lit for photos',
    ],
    restrictionApplied,
  };
}

/**
 * Check for quality decline trigger
 */
function checkQualityDecline(metrics: StudentMetrics): CoachingRecommendation | null {
  if (metrics.qualityTrend !== 'declining' || metrics.avgQualityScore >= 0.7) {
    return null;
  }

  let severity: 'mild' | 'moderate' | 'severe';
  let restrictionApplied: string | undefined;

  if (metrics.avgQualityScore < 0.5) {
    severity = 'severe';
    restrictionApplied = 'Quality review required before next task';
  } else if (metrics.avgQualityScore < 0.6) {
    severity = 'moderate';
  } else {
    severity = 'mild';
  }

  return {
    trigger: 'quality_decline',
    severity,
    title: 'Quality Score Trending Down',
    message: `Your quality score has been declining. Current average: ${Math.round(metrics.avgQualityScore * 100)}%`,
    tips: [
      'Take your time to understand requirements fully',
      'Review your work before submitting',
      'Focus on fewer tasks but higher quality',
      'Ask for feedback on completed tasks',
    ],
    restrictionApplied,
  };
}

/**
 * Analyze student and generate coaching recommendations
 */
export async function analyzeForCoaching(studentId: string): Promise<{
  needsCoaching: boolean;
  recommendations: CoachingRecommendation[];
  metrics: StudentMetrics;
}> {
  const metrics = await getStudentMetrics(studentId);
  const recommendations: CoachingRecommendation[] = [];

  // Check all triggers
  const revisionCheck = checkRevisionPattern(metrics);
  if (revisionCheck) recommendations.push(revisionCheck);

  const deadlineCheck = checkDeadlineIssues(metrics);
  if (deadlineCheck) recommendations.push(deadlineCheck);

  const powCheck = checkPOWFailures(metrics);
  if (powCheck) recommendations.push(powCheck);

  const qualityCheck = checkQualityDecline(metrics);
  if (qualityCheck) recommendations.push(qualityCheck);

  // Sort by severity
  const severityOrder = { severe: 0, moderate: 1, mild: 2 };
  recommendations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    needsCoaching: recommendations.length > 0,
    recommendations,
    metrics,
  };
}

/**
 * Generate AI-personalized coaching message
 */
export async function generatePersonalizedCoaching(
  studentName: string,
  recommendations: CoachingRecommendation[]
): Promise<string> {
  if (recommendations.length === 0) {
    return "You're doing great! Keep up the good work.";
  }

  const issues = recommendations.map(r => `- ${r.title}: ${r.message}`).join('\n');
  const allTips = recommendations.flatMap(r => r.tips);

  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: 'gpt-5.2',
    messages: [
      {
        role: 'system',
        content: `You are a supportive career coach for student contractors. Write brief, encouraging coaching messages that address issues while maintaining a positive tone. Be specific and actionable. Keep it under 150 words.`,
      },
      {
        role: 'user',
        content: `Write a coaching message for ${studentName} addressing these areas:

${issues}

Include 2-3 of these tips naturally in your message:
${allTips.slice(0, 5).join('\n')}`,
      },
    ],
    max_tokens: 200,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || 'Keep working on improving your performance!';
}

/**
 * Send coaching notification to student
 */
export async function sendCoachingNotification(studentId: string): Promise<{
  sent: boolean;
  recommendations?: CoachingRecommendation[];
}> {
  const analysis = await analyzeForCoaching(studentId);

  if (!analysis.needsCoaching) {
    return { sent: false };
  }

  const student = await db.studentProfile.findUnique({
    where: { id: studentId },
    select: { name: true, clerkId: true },
  });

  const personalizedMessage = await generatePersonalizedCoaching(
    student?.name || 'there',
    analysis.recommendations
  );

  // Apply restrictions if any
  for (const rec of analysis.recommendations) {
    if (rec.restrictionApplied) {
      // Log coaching action as a notification
      await db.notification.create({
        data: {
          userId: student?.clerkId || studentId,
          userType: 'student',
          type: 'coaching_restriction',
          title: `Coaching: ${rec.trigger}`,
          body: rec.restrictionApplied,
          channels: ['in_app'],
          data: {
            trigger: rec.trigger,
            severity: rec.severity,
          },
        },
      });
    }
  }

  // Send main coaching notification
  await notificationQueue.add('send', {
    userId: student?.clerkId || studentId,
    userType: 'student',
    type: 'coaching',
    title: '💪 Coaching Tips for You',
    body: personalizedMessage,
    channels: ['in_app'],
    data: {
      recommendations: analysis.recommendations.map(r => ({
        trigger: r.trigger,
        severity: r.severity,
        title: r.title,
      })),
    },
  });

  return {
    sent: true,
    recommendations: analysis.recommendations,
  };
}

/**
 * Run coaching check for all active students
 */
export async function runCoachingCheck(): Promise<{
  studentsChecked: number;
  coachingSent: number;
}> {
  const activeStudents = await db.studentProfile.findMany({
    where: {
      kycStatus: 'verified',
      tasksCompleted: { gt: 0 },
    },
    select: { id: true },
  });

  let coachingSent = 0;

  for (const student of activeStudents) {
    const result = await sendCoachingNotification(student.id);
    if (result.sent) coachingSent++;
  }

  return {
    studentsChecked: activeStudents.length,
    coachingSent,
  };
}
