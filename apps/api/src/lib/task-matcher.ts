/**
 * Task Matcher - Multi-factor scoring for student-task matching
 * 
 * Factors considered:
 * 1. Skill overlap - required skills vs student skills
 * 2. Category history - success in similar task types
 * 3. Revision tendency - how often student needs revisions
 * 4. Recent failures - recent task failures or disputes
 * 5. Progressive trust - tier-based restrictions
 * 6. Availability - current workload
 */

import { db } from '@figwork/db';

export interface MatchFactor {
  name: string;
  score: number; // 0-100
  weight: number;
  reason?: string;
}

export interface MatchResult {
  eligible: boolean;
  score: number; // 0-100
  factors: MatchFactor[];
  restrictions: string[];
  recommendation: 'strong' | 'good' | 'acceptable' | 'poor' | 'ineligible';
}

interface StudentProfile {
  id: string;
  tier: string;
  skillTags: string[];
  tasksCompleted: number;
  avgQualityScore: number;
  revisionRate: number;
  onTimeRate: number;
  recentFailures: number;
}

interface WorkUnit {
  id: string;
  category: string;
  requiredSkills: string[];
  minTier: string;
  priceInCents: number;
}

interface StudentHistory {
  categorySuccessRate: Record<string, number>;
  recentFailures: number;
  activeExecutions: number;
  lastRevisionDate: Date | null;
  consecutiveRevisions: number;
}

const TIER_LEVELS: Record<string, number> = {
  novice: 1,
  pro: 2,
  elite: 3,
};

const TIER_MAX_DAILY: Record<string, number> = {
  novice: 2,
  pro: 5,
  elite: 10,
};

/**
 * Factor 1: Skill Overlap
 * How well student's skills match required skills
 */
function calculateSkillOverlap(
  studentSkills: string[],
  requiredSkills: string[]
): MatchFactor {
  if (requiredSkills.length === 0) {
    return {
      name: 'skillOverlap',
      score: 100,
      weight: 1.5,
      reason: 'No specific skills required',
    };
  }

  const studentSkillsLower = studentSkills.map(s => s.toLowerCase());
  const matchedSkills = requiredSkills.filter(skill =>
    studentSkillsLower.some(s => 
      s.includes(skill.toLowerCase()) || skill.toLowerCase().includes(s)
    )
  );

  const overlapRatio = matchedSkills.length / requiredSkills.length;
  const score = Math.round(overlapRatio * 100);

  let reason: string;
  if (score === 100) {
    reason = 'All required skills matched';
  } else if (score >= 70) {
    reason = `${matchedSkills.length}/${requiredSkills.length} skills matched`;
  } else if (score >= 50) {
    reason = `Partial skill match (${matchedSkills.length}/${requiredSkills.length})`;
  } else {
    reason = `Low skill match - missing key skills`;
  }

  return {
    name: 'skillOverlap',
    score,
    weight: 1.5,
    reason,
  };
}

/**
 * Factor 2: Category History
 * Success rate in similar task categories
 */
function calculateCategoryHistory(
  category: string,
  history: StudentHistory
): MatchFactor {
  const successRate = history.categorySuccessRate[category];

  if (successRate === undefined) {
    // No history in this category - neutral score
    return {
      name: 'categoryHistory',
      score: 50,
      weight: 1.0,
      reason: 'No previous experience in this category',
    };
  }

  const score = Math.round(successRate * 100);

  let reason: string;
  if (score >= 90) {
    reason = `Excellent track record in ${category} (${score}% success)`;
  } else if (score >= 70) {
    reason = `Good history in ${category} (${score}% success)`;
  } else if (score >= 50) {
    reason = `Mixed results in ${category} (${score}% success)`;
  } else {
    reason = `Poor performance in ${category} - consider different task type`;
  }

  return {
    name: 'categoryHistory',
    score,
    weight: 1.0,
    reason,
  };
}

/**
 * Factor 3: Revision Tendency
 * How often student's work needs revisions
 */
function calculateRevisionTendency(
  revisionRate: number,
  consecutiveRevisions: number
): MatchFactor {
  // Base score from overall revision rate (lower is better)
  let score = Math.round((1 - revisionRate) * 100);

  // Penalty for consecutive revisions (recent pattern)
  if (consecutiveRevisions >= 3) {
    score = Math.max(0, score - 30);
  } else if (consecutiveRevisions >= 2) {
    score = Math.max(0, score - 15);
  }

  let reason: string;
  if (score >= 85) {
    reason = 'Consistently delivers quality work';
  } else if (score >= 65) {
    reason = `Occasional revisions needed (${Math.round(revisionRate * 100)}% rate)`;
  } else if (score >= 40) {
    reason = `Frequent revisions required (${Math.round(revisionRate * 100)}% rate)`;
  } else {
    reason = `High revision rate - may need coaching`;
  }

  return {
    name: 'revisionTendency',
    score,
    weight: 1.2,
    reason,
  };
}

/**
 * Factor 4: Recent Failures
 * Penalize recent task failures or disputes
 */
function calculateRecentFailures(recentFailures: number): MatchFactor {
  let score: number;
  let reason: string;

  if (recentFailures === 0) {
    score = 100;
    reason = 'No recent issues';
  } else if (recentFailures === 1) {
    score = 70;
    reason = '1 recent failure - minor concern';
  } else if (recentFailures === 2) {
    score = 40;
    reason = '2 recent failures - elevated risk';
  } else {
    score = 10;
    reason = `${recentFailures} recent failures - high risk`;
  }

  return {
    name: 'recentFailures',
    score,
    weight: 1.3,
    reason,
  };
}

/**
 * Factor 5: Progressive Trust
 * Tier-based eligibility and restrictions
 */
function calculateProgressiveTrust(
  studentTier: string,
  minTier: string,
  tasksCompleted: number
): MatchFactor {
  const studentLevel = TIER_LEVELS[studentTier] || 1;
  const requiredLevel = TIER_LEVELS[minTier] || 1;

  if (studentLevel < requiredLevel) {
    return {
      name: 'progressiveTrust',
      score: 0,
      weight: 2.0, // High weight - this is a hard requirement
      reason: `Requires ${minTier} tier (student is ${studentTier})`,
    };
  }

  // Novice probation: first 5 tasks have restrictions
  if (studentTier === 'novice' && tasksCompleted < 5) {
    return {
      name: 'progressiveTrust',
      score: 50,
      weight: 2.0,
      reason: `Novice probation (${tasksCompleted}/5 tasks completed)`,
    };
  }

  // Novice established: 5-20 tasks
  if (studentTier === 'novice' && tasksCompleted < 20) {
    return {
      name: 'progressiveTrust',
      score: 75,
      weight: 2.0,
      reason: `Novice established (${tasksCompleted} tasks completed)`,
    };
  }

  return {
    name: 'progressiveTrust',
    score: 100,
    weight: 2.0,
    reason: `${studentTier} tier - full access`,
  };
}

/**
 * Factor 6: Availability
 * Current workload and daily limits
 */
function calculateAvailability(
  studentTier: string,
  activeExecutions: number
): MatchFactor {
  const maxDaily = TIER_MAX_DAILY[studentTier as keyof typeof TIER_MAX_DAILY] || 2;
  const utilizationRatio = activeExecutions / maxDaily;

  let score: number;
  let reason: string;

  if (activeExecutions >= maxDaily) {
    score = 0;
    reason = `Daily limit reached (${activeExecutions}/${maxDaily})`;
  } else if (utilizationRatio > 0.8) {
    score = 30;
    reason = `Near daily limit (${activeExecutions}/${maxDaily})`;
  } else if (utilizationRatio > 0.5) {
    score = 70;
    reason = `Moderate workload (${activeExecutions}/${maxDaily})`;
  } else {
    score = 100;
    reason = `Available (${activeExecutions}/${maxDaily} active)`;
  }

  return {
    name: 'availability',
    score,
    weight: 1.0,
    reason,
  };
}

/**
 * Get student's history for matching calculations
 */
async function getStudentHistory(studentId: string): Promise<StudentHistory> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get recent executions for category success rates
  const executions = await db.execution.findMany({
    where: {
      studentId,
      assignedAt: { gte: thirtyDaysAgo },
    },
    include: {
      workUnit: { select: { category: true } },
    },
  });

  // Calculate category success rates
  const categoryStats: Record<string, { total: number; success: number }> = {};
  for (const exec of executions) {
    const cat = exec.workUnit.category;
    if (!categoryStats[cat]) {
      categoryStats[cat] = { total: 0, success: 0 };
    }
    categoryStats[cat].total++;
    if (exec.status === 'approved') {
      categoryStats[cat].success++;
    }
  }

  const categorySuccessRate: Record<string, number> = {};
  for (const [cat, stats] of Object.entries(categoryStats)) {
    categorySuccessRate[cat] = stats.total > 0 ? stats.success / stats.total : 0;
  }

  // Count recent failures (failed or disputed in last 30 days)
  const recentFailures = executions.filter(e => 
    e.status === 'failed' || e.status === 'disputed'
  ).length;

  // Count active executions
  const activeExecutions = await db.execution.count({
    where: {
      studentId,
      status: { in: ['accepted', 'clocked_in', 'submitted', 'revision_needed'] },
    },
  });

  // Get consecutive revisions
  const recentWithRevisions = await db.execution.findMany({
    where: {
      studentId,
      status: { in: ['approved', 'revision_needed'] },
    },
    orderBy: { assignedAt: 'desc' },
    take: 5,
    include: {
      revisionRequests: true,
    },
  });

  let consecutiveRevisions = 0;
  let lastRevisionDate: Date | null = null;
  for (const exec of recentWithRevisions) {
    if (exec.revisionRequests.length > 0) {
      consecutiveRevisions++;
      if (!lastRevisionDate) {
        lastRevisionDate = exec.revisionRequests[0].createdAt;
      }
    } else {
      break; // Stop counting when we hit one without revisions
    }
  }

  return {
    categorySuccessRate,
    recentFailures,
    activeExecutions,
    lastRevisionDate,
    consecutiveRevisions,
  };
}

/**
 * Calculate comprehensive match score between student and work unit
 */
export async function calculateMatch(
  student: StudentProfile,
  workUnit: WorkUnit
): Promise<MatchResult> {
  const history = await getStudentHistory(student.id);

  const factors: MatchFactor[] = [
    calculateSkillOverlap(student.skillTags, workUnit.requiredSkills),
    calculateCategoryHistory(workUnit.category, history),
    calculateRevisionTendency(student.revisionRate, history.consecutiveRevisions),
    calculateRecentFailures(history.recentFailures),
    calculateProgressiveTrust(student.tier, workUnit.minTier, student.tasksCompleted),
    calculateAvailability(student.tier, history.activeExecutions),
  ];

  // Check for blocking factors
  const restrictions: string[] = [];
  let eligible = true;

  for (const factor of factors) {
    if (factor.score === 0 && factor.weight >= 1.5) {
      eligible = false;
      restrictions.push(factor.reason || factor.name);
    }
  }

  // Revision gate: block if 3+ consecutive revisions
  if (history.consecutiveRevisions >= 3) {
    eligible = false;
    restrictions.push('Must complete a task without revisions before taking new work');
  }

  // Calculate weighted score
  let totalWeight = 0;
  let weightedSum = 0;

  for (const factor of factors) {
    weightedSum += factor.score * factor.weight;
    totalWeight += factor.weight;
  }

  const score = eligible ? Math.round(weightedSum / totalWeight) : 0;

  // Determine recommendation
  let recommendation: MatchResult['recommendation'];
  if (!eligible) {
    recommendation = 'ineligible';
  } else if (score >= 85) {
    recommendation = 'strong';
  } else if (score >= 70) {
    recommendation = 'good';
  } else if (score >= 50) {
    recommendation = 'acceptable';
  } else {
    recommendation = 'poor';
  }

  return {
    eligible,
    score,
    factors,
    restrictions,
    recommendation,
  };
}

/**
 * Find best matching students for a work unit
 */
export async function findBestMatches(
  workUnit: WorkUnit,
  limit: number = 10
): Promise<Array<{ studentId: string; match: MatchResult }>> {
  // Get eligible students based on tier
  const minTierLevel = TIER_LEVELS[workUnit.minTier] || 1;
  const eligibleTiers = Object.entries(TIER_LEVELS)
    .filter(([, level]) => level >= minTierLevel)
    .map(([tier]) => tier);

  const students = await db.studentProfile.findMany({
    where: {
      tier: { in: eligibleTiers },
      kycStatus: 'verified',
      taxStatus: { in: ['submitted', 'verified'] },
      contractStatus: 'signed',
    },
  });

  const matches: Array<{ studentId: string; match: MatchResult }> = [];

  for (const student of students) {
    const match = await calculateMatch(
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
      workUnit
    );

    if (match.eligible) {
      matches.push({ studentId: student.id, match });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.match.score - a.match.score);

  return matches.slice(0, limit);
}
