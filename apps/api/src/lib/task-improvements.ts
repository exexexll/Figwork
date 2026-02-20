/**
 * Task Improvement Suggestions
 * 
 * Analyzes defect patterns to suggest improvements:
 * - Specification improvements
 * - Deadline adjustments
 * - Skill requirements
 * - Example additions
 */

import { db } from '@figwork/db';
import { getOpenAIClient } from '@figwork/ai';

export interface ImprovementSuggestion {
  type: 'spec' | 'deadline' | 'skills' | 'examples' | 'criteria' | 'tier';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  currentValue?: string;
  suggestedValue?: string;
}

export interface TaskAnalysis {
  workUnitId: string;
  defectCount: number;
  revisionRate: number;
  commonIssues: Array<{ issue: string; count: number }>;
  suggestions: ImprovementSuggestion[];
  overallHealth: 'good' | 'needs_attention' | 'critical';
}

/**
 * Analyze a work unit's defect history and generate suggestions
 */
export async function analyzeTaskForImprovements(workUnitId: string): Promise<TaskAnalysis> {
  const workUnit = await db.workUnit.findUnique({
    where: { id: workUnitId },
    include: {
      defectAnalyses: true,
      executions: {
        include: {
          revisionRequests: true,
        },
      },
    },
  });

  if (!workUnit) {
    throw new Error(`Work unit ${workUnitId} not found`);
  }

  const totalExecutions = workUnit.executions.length;
  const executionsWithRevisions = workUnit.executions.filter(e => e.revisionCount > 0).length;
  const revisionRate = totalExecutions > 0 ? executionsWithRevisions / totalExecutions : 0;
  const defectCount = workUnit.defectAnalyses.length;

  // Aggregate common issues from defects
  const issueCounts: Record<string, number> = {};
  for (const defect of workUnit.defectAnalyses) {
    const key = defect.rootCause;
    issueCounts[key] = (issueCounts[key] || 0) + 1;
  }

  const commonIssues = Object.entries(issueCounts)
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Determine overall health
  let overallHealth: TaskAnalysis['overallHealth'] = 'good';
  if (revisionRate > 0.5 || defectCount >= 3) {
    overallHealth = 'critical';
  } else if (revisionRate > 0.25 || defectCount >= 1) {
    overallHealth = 'needs_attention';
  }

  // Generate suggestions based on defect patterns
  const suggestions = await generateSuggestions(workUnit, commonIssues, revisionRate);

  return {
    workUnitId,
    defectCount,
    revisionRate,
    commonIssues,
    suggestions,
    overallHealth,
  };
}

/**
 * Generate specific improvement suggestions
 */
async function generateSuggestions(
  workUnit: any,
  commonIssues: Array<{ issue: string; count: number }>,
  revisionRate: number
): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];

  // Check clarity score
  if (workUnit.clarityScore !== null && workUnit.clarityScore < 70) {
    suggestions.push({
      type: 'spec',
      priority: 'high',
      title: 'Improve Task Specification',
      description: `Current clarity score is ${Math.round(workUnit.clarityScore)}/100. Consider adding more detail and explicit requirements.`,
      currentValue: `${workUnit.spec.substring(0, 100)}...`,
    });
  }

  // Check for vague specification issues
  const specIssues = commonIssues.filter(i => 
    i.issue.includes('vague') || i.issue.includes('clarity') || i.issue.includes('unclear')
  );
  if (specIssues.length > 0) {
    suggestions.push({
      type: 'spec',
      priority: specIssues[0].count >= 2 ? 'high' : 'medium',
      title: 'Clarify Ambiguous Requirements',
      description: `${specIssues.reduce((sum, i) => sum + i.count, 0)} issues related to unclear specifications. Add specific examples and measurable criteria.`,
    });
  }

  // Check deadline issues
  const deadlineIssues = commonIssues.filter(i => 
    i.issue.includes('deadline') || i.issue.includes('time') || i.issue.includes('late')
  );
  if (deadlineIssues.length > 0 || revisionRate > 0.3) {
    suggestions.push({
      type: 'deadline',
      priority: 'medium',
      title: 'Consider Extending Deadline',
      description: `Current deadline is ${workUnit.deadlineHours} hours. Based on execution history, consider extending by 25-50%.`,
      currentValue: `${workUnit.deadlineHours} hours`,
      suggestedValue: `${Math.round(workUnit.deadlineHours * 1.35)} hours`,
    });
  }

  // Check skill mismatch issues
  const skillIssues = commonIssues.filter(i => 
    i.issue.includes('skill') || i.issue.includes('mismatch') || i.issue.includes('experience')
  );
  if (skillIssues.length > 0) {
    suggestions.push({
      type: 'skills',
      priority: 'medium',
      title: 'Refine Skill Requirements',
      description: 'Consider adding more specific skill requirements or adjusting the minimum tier.',
      currentValue: workUnit.requiredSkills?.join(', ') || 'None specified',
    });
  }

  // Check if examples are needed
  if (!workUnit.hasExamples && revisionRate > 0.2) {
    suggestions.push({
      type: 'examples',
      priority: 'medium',
      title: 'Add Reference Examples',
      description: 'Tasks with examples have 40% fewer revisions. Consider adding visual references or sample outputs.',
    });
  }

  // Check acceptance criteria
  const criteriaArray = Array.isArray(workUnit.acceptanceCriteria)
    ? workUnit.acceptanceCriteria
    : [];
  if (criteriaArray.length < 3) {
    suggestions.push({
      type: 'criteria',
      priority: 'high',
      title: 'Expand Acceptance Criteria',
      description: 'Tasks with 5+ explicit acceptance criteria have clearer expectations. Add measurable checkpoints.',
      currentValue: `${criteriaArray.length} criteria`,
      suggestedValue: '5-7 criteria',
    });
  }

  // Check tier appropriateness
  const tierIssues = commonIssues.filter(i => i.issue.includes('tier') || i.issue.includes('level'));
  if (tierIssues.length > 0) {
    suggestions.push({
      type: 'tier',
      priority: 'low',
      title: 'Adjust Minimum Tier',
      description: `Current minimum tier is ${workUnit.minTier}. Based on complexity, consider adjusting.`,
      currentValue: workUnit.minTier,
    });
  }

  // Use AI to generate additional suggestions if defect count is high
  if (workUnit.defectAnalyses.length >= 2) {
    const aiSuggestions = await getAISuggestions(workUnit, commonIssues);
    suggestions.push(...aiSuggestions);
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return suggestions.slice(0, 7); // Return top 7 suggestions
}

/**
 * Get AI-generated suggestions for complex cases
 */
async function getAISuggestions(
  workUnit: any,
  commonIssues: Array<{ issue: string; count: number }>
): Promise<ImprovementSuggestion[]> {
  const openai = getOpenAIClient();

  const prompt = `Analyze this task specification and its defect history, then suggest 2-3 specific improvements:

TASK:
Title: ${workUnit.title}
Spec: ${workUnit.spec.substring(0, 500)}
Category: ${workUnit.category}
Deadline: ${workUnit.deadlineHours} hours
Price: $${(workUnit.priceInCents / 100).toFixed(2)}
Min Tier: ${workUnit.minTier}

COMMON ISSUES:
${commonIssues.map(i => `- ${i.issue}: ${i.count} occurrences`).join('\n')}

Provide suggestions in JSON format:
[
  {
    "type": "spec|deadline|skills|examples|criteria",
    "priority": "high|medium|low",
    "title": "Brief title",
    "description": "Specific actionable suggestion",
    "suggestedValue": "optional specific recommendation"
  }
]`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        {
          role: 'system',
          content: 'You are a task quality analyst. Provide specific, actionable improvement suggestions based on defect patterns. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.5,
    });

    const content = response.choices[0]?.message?.content || '[]';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const suggestions = JSON.parse(jsonMatch[0]);
      return suggestions.map((s: any) => ({
        ...s,
        type: s.type || 'spec',
        priority: s.priority || 'medium',
      }));
    }
  } catch (e) {
    console.error('Failed to get AI suggestions:', e);
  }

  return [];
}

/**
 * Get improvement suggestions for all work units with issues
 */
export async function getCompanyTaskImprovements(companyId: string): Promise<{
  critical: TaskAnalysis[];
  needsAttention: TaskAnalysis[];
  healthy: number;
}> {
  const workUnits = await db.workUnit.findMany({
    where: { companyId },
    select: { id: true },
  });

  const critical: TaskAnalysis[] = [];
  const needsAttention: TaskAnalysis[] = [];
  let healthy = 0;

  for (const wu of workUnits) {
    try {
      const analysis = await analyzeTaskForImprovements(wu.id);
      if (analysis.overallHealth === 'critical') {
        critical.push(analysis);
      } else if (analysis.overallHealth === 'needs_attention') {
        needsAttention.push(analysis);
      } else {
        healthy++;
      }
    } catch (e) {
      console.error(`Failed to analyze work unit ${wu.id}:`, e);
    }
  }

  return { critical, needsAttention, healthy };
}

/**
 * Apply suggestion to a work unit (draft changes)
 */
export async function applySuggestion(
  workUnitId: string,
  suggestion: ImprovementSuggestion
): Promise<{ success: boolean; message: string }> {
  const workUnit = await db.workUnit.findUnique({ where: { id: workUnitId } });
  if (!workUnit) {
    return { success: false, message: 'Work unit not found' };
  }

  // For now, log the suggestion application
  // In production, this would actually update the work unit
  console.log(`[TaskImprovement] Applying ${suggestion.type} suggestion to ${workUnitId}`);

  // Create a note about the improvement
  await db.workUnit.update({
    where: { id: workUnitId },
    data: {
      clarityIssues: {
        ...(typeof workUnit.clarityIssues === 'object' ? workUnit.clarityIssues : {}),
        lastSuggestion: {
          type: suggestion.type,
          title: suggestion.title,
          appliedAt: new Date().toISOString(),
        },
      } as any,
    },
  });

  return {
    success: true,
    message: `Suggestion "${suggestion.title}" noted. Update the task specification to implement changes.`,
  };
}
