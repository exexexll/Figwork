/**
 * Clarity Checker - Analyzes work unit specifications for completeness and clarity
 * 
 * Runs 6 structured checks:
 * 1. specLength - minimum meaningful content
 * 2. acceptanceCriteria - measurable completion criteria
 * 3. deliverableFormat - clear output expectations
 * 4. ambiguousLanguage - vague terms that cause confusion
 * 5. examples - concrete examples aid understanding
 * 6. deadlineReasonable - deadline matches complexity
 */

import { getOpenAIClient } from '@figwork/ai';

export interface ClarityCheck {
  name: string;
  passed: boolean;
  score: number; // 0-100
  issue?: string;
  suggestion?: string;
}

export interface ClarityResult {
  overallScore: number; // 0-100
  passed: boolean;
  checks: ClarityCheck[];
  summary: string;
}

// Ambiguous terms that commonly cause task confusion
const AMBIGUOUS_TERMS = [
  'asap', 'soon', 'quick', 'simple', 'easy', 'basic',
  'good', 'nice', 'better', 'improve', 'enhance',
  'some', 'few', 'many', 'several', 'various',
  'etc', 'and so on', 'stuff like that',
  'professional', 'modern', 'clean', 'sleek',
  'user-friendly', 'intuitive', 'seamless',
];

// Words indicating measurable criteria
const MEASURABLE_INDICATORS = [
  'must', 'should', 'will', 'exactly', 'minimum', 'maximum',
  'at least', 'no more than', 'within', 'before', 'after',
  'include', 'contain', 'format', 'type', 'size', 'count',
  'pass', 'fail', 'test', 'verify', 'check', 'validate',
];

// Deliverable format keywords
const DELIVERABLE_FORMATS = [
  'pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'svg', 'gif',
  'mp4', 'mov', 'mp3', 'wav', 'zip', 'csv', 'xlsx', 'json',
  'figma', 'sketch', 'psd', 'ai', 'source file', 'editable',
  'github', 'repository', 'link', 'url', 'hosted', 'deployed',
];

/**
 * Check 1: Specification Length
 * Ensures spec has minimum meaningful content
 */
function checkSpecLength(spec: string): ClarityCheck {
  const wordCount = spec.trim().split(/\s+/).length;
  const sentenceCount = spec.split(/[.!?]+/).filter(s => s.trim()).length;
  
  let score = 0;
  let issue: string | undefined;
  let suggestion: string | undefined;
  
  if (wordCount < 20) {
    score = 20;
    issue = `Specification too short (${wordCount} words)`;
    suggestion = 'Add more detail about what you need. Explain the context, requirements, and expected output.';
  } else if (wordCount < 50) {
    score = 50;
    issue = `Specification could be more detailed (${wordCount} words)`;
    suggestion = 'Consider adding more context about your project, specific requirements, and quality expectations.';
  } else if (wordCount < 100) {
    score = 75;
  } else {
    score = 100;
  }
  
  return {
    name: 'specLength',
    passed: score >= 50,
    score,
    issue,
    suggestion,
  };
}

/**
 * Check 2: Acceptance Criteria
 * Looks for measurable completion criteria
 */
function checkAcceptanceCriteria(
  spec: string,
  acceptanceCriteria: string[]
): ClarityCheck {
  const specLower = spec.toLowerCase();
  const criteriaText = acceptanceCriteria.join(' ').toLowerCase();
  const combinedText = `${specLower} ${criteriaText}`;
  
  // Count measurable indicators
  const measurableCount = MEASURABLE_INDICATORS.filter(term => 
    combinedText.includes(term)
  ).length;
  
  // Check if acceptance criteria are defined
  const hasCriteria = acceptanceCriteria.length > 0;
  const criteriaQuality = acceptanceCriteria.filter(c => c.length > 10).length;
  
  let score = 0;
  let issue: string | undefined;
  let suggestion: string | undefined;
  
  if (!hasCriteria) {
    score = 20;
    issue = 'No acceptance criteria defined';
    suggestion = 'Add specific acceptance criteria. What exactly needs to be true for you to accept the deliverable?';
  } else if (criteriaQuality < 2) {
    score = 50;
    issue = 'Acceptance criteria are too vague';
    suggestion = 'Make criteria more specific. Use numbers, formats, and testable conditions.';
  } else if (measurableCount < 3) {
    score = 70;
    issue = 'Criteria could be more measurable';
    suggestion = 'Add measurable terms like "must include", "minimum X", "formatted as Y".';
  } else {
    score = 100;
  }
  
  return {
    name: 'acceptanceCriteria',
    passed: score >= 50,
    score,
    issue,
    suggestion,
  };
}

/**
 * Check 3: Deliverable Format
 * Ensures clear output expectations
 */
function checkDeliverableFormat(
  spec: string,
  acceptanceCriteria: string[]
): ClarityCheck {
  const combinedText = `${spec} ${acceptanceCriteria.join(' ')}`.toLowerCase();
  
  // Count format indicators
  const formatCount = DELIVERABLE_FORMATS.filter(format => 
    combinedText.includes(format)
  ).length;
  
  // Check for explicit deliverable mentions
  const hasDeliverableMention = /deliver|submit|provide|send|upload|attach|include/i.test(combinedText);
  
  let score = 0;
  let issue: string | undefined;
  let suggestion: string | undefined;
  
  if (formatCount === 0 && !hasDeliverableMention) {
    score = 30;
    issue = 'No clear deliverable format specified';
    suggestion = 'Specify what format the deliverables should be in (e.g., PDF, Figma file, deployed URL).';
  } else if (formatCount === 0) {
    score = 60;
    issue = 'Deliverable format could be clearer';
    suggestion = 'Be specific about file formats, resolutions, or platforms.';
  } else {
    score = 100;
  }
  
  return {
    name: 'deliverableFormat',
    passed: score >= 50,
    score,
    issue,
    suggestion,
  };
}

/**
 * Check 4: Ambiguous Language
 * Detects vague terms that cause confusion
 */
function checkAmbiguousLanguage(spec: string): ClarityCheck {
  const specLower = spec.toLowerCase();
  
  // Find ambiguous terms used
  const foundAmbiguous = AMBIGUOUS_TERMS.filter(term => 
    specLower.includes(term)
  );
  
  let score = 0;
  let issue: string | undefined;
  let suggestion: string | undefined;
  
  if (foundAmbiguous.length === 0) {
    score = 100;
  } else if (foundAmbiguous.length <= 2) {
    score = 75;
    issue = `Contains some vague terms: "${foundAmbiguous.join('", "')}"`;
    suggestion = 'Replace vague terms with specific, measurable requirements.';
  } else if (foundAmbiguous.length <= 5) {
    score = 50;
    issue = `Multiple vague terms found: "${foundAmbiguous.slice(0, 3).join('", "')}"...`;
    suggestion = 'Too many ambiguous terms. Be specific about what "good", "simple", or "professional" means to you.';
  } else {
    score = 25;
    issue = 'Specification relies heavily on vague language';
    suggestion = 'Rewrite with concrete requirements. Replace "make it look nice" with specific colors, fonts, layouts.';
  }
  
  return {
    name: 'ambiguousLanguage',
    passed: score >= 50,
    score,
    issue,
    suggestion,
  };
}

/**
 * Check 5: Examples
 * Checks if concrete examples are provided
 */
function checkExamples(spec: string): ClarityCheck {
  const specLower = spec.toLowerCase();
  
  // Indicators of examples
  const exampleIndicators = [
    'example', 'for instance', 'such as', 'like this',
    'similar to', 'reference', 'inspiration', 'attached',
    'see', 'look at', 'based on', 'following',
    'http', 'www.', '.com', '.io', 'figma.com', 'dribbble',
  ];
  
  const hasExamples = exampleIndicators.some(indicator => 
    specLower.includes(indicator)
  );
  
  let score = 0;
  let issue: string | undefined;
  let suggestion: string | undefined;
  
  if (hasExamples) {
    score = 100;
  } else {
    score = 50;
    issue = 'No examples or references provided';
    suggestion = 'Add examples, reference links, or inspiration sources. This significantly reduces misunderstandings.';
  }
  
  return {
    name: 'examples',
    passed: score >= 50,
    score,
    issue,
    suggestion,
  };
}

/**
 * Check 6: Deadline Reasonableness
 * Validates deadline matches estimated complexity
 */
function checkDeadlineReasonable(
  spec: string,
  deadlineHours: number,
  priceInCents: number
): ClarityCheck {
  const wordCount = spec.trim().split(/\s+/).length;
  
  // Estimate minimum hours based on spec complexity and price
  // Rule: ~$15-25/hour is typical, longer spec = more complex
  const impliedHours = priceInCents / 2000; // $20/hr baseline
  const complexityFactor = Math.max(1, wordCount / 100); // Longer specs = more complex
  const minReasonableHours = Math.max(1, impliedHours * complexityFactor * 0.5);
  
  let score = 0;
  let issue: string | undefined;
  let suggestion: string | undefined;
  
  if (deadlineHours < minReasonableHours) {
    score = 30;
    issue = `Deadline (${deadlineHours}h) seems tight for this scope`;
    suggestion = `Consider extending to at least ${Math.ceil(minReasonableHours)}h or simplifying requirements.`;
  } else if (deadlineHours < minReasonableHours * 1.5) {
    score = 70;
    issue = 'Deadline is achievable but leaves little buffer';
    suggestion = 'Consider adding 20-50% buffer time for revisions.';
  } else {
    score = 100;
  }
  
  return {
    name: 'deadlineReasonable',
    passed: score >= 50,
    score,
    issue,
    suggestion,
  };
}

/**
 * Run all clarity checks on a work unit specification
 */
export async function checkClarity(input: {
  title: string;
  spec: string;
  acceptanceCriteria: string[];
  priceInCents: number;
  deadlineHours: number;
  category: string;
}): Promise<ClarityResult> {
  const { spec, acceptanceCriteria, priceInCents, deadlineHours } = input;
  
  // Run all checks
  const checks: ClarityCheck[] = [
    checkSpecLength(spec),
    checkAcceptanceCriteria(spec, acceptanceCriteria),
    checkDeliverableFormat(spec, acceptanceCriteria),
    checkAmbiguousLanguage(spec),
    checkExamples(spec),
    checkDeadlineReasonable(spec, deadlineHours, priceInCents),
  ];
  
  // Calculate overall score (weighted average)
  const weights = {
    specLength: 1,
    acceptanceCriteria: 1.5,
    deliverableFormat: 1,
    ambiguousLanguage: 1.2,
    examples: 0.8,
    deadlineReasonable: 1,
  };
  
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const check of checks) {
    const weight = weights[check.name as keyof typeof weights] || 1;
    weightedSum += check.score * weight;
    totalWeight += weight;
  }
  
  const overallScore = Math.round(weightedSum / totalWeight);
  const passed = overallScore >= 60 && checks.every(c => c.score >= 30);
  
  // Generate summary
  const failedChecks = checks.filter(c => !c.passed);
  let summary: string;
  
  if (passed && overallScore >= 80) {
    summary = 'Specification is clear and well-defined.';
  } else if (passed) {
    summary = `Specification is acceptable but could be improved. ${failedChecks.length} area(s) need attention.`;
  } else {
    summary = `Specification needs work. ${failedChecks.length} critical issue(s) found.`;
  }
  
  return {
    overallScore,
    passed,
    checks,
    summary,
  };
}

/**
 * Use AI to generate improved suggestions for a failing spec
 */
export async function generateClaritySuggestions(input: {
  title: string;
  spec: string;
  acceptanceCriteria: string[];
  category: string;
  failedChecks: ClarityCheck[];
}): Promise<string> {
  const { title, spec, acceptanceCriteria, category, failedChecks } = input;
  
  const issues = failedChecks.map(c => `- ${c.name}: ${c.issue}`).join('\n');
  
  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a task clarity expert. Help improve work unit specifications to reduce misunderstandings and revisions. Be concise and actionable.`,
      },
      {
        role: 'user',
        content: `Task: ${title}
Category: ${category}

Current Spec:
${spec}

Acceptance Criteria:
${acceptanceCriteria.join('\n') || 'None specified'}

Issues Found:
${issues}

Provide 2-3 specific, actionable suggestions to improve this specification. Focus on the identified issues.`,
      },
    ],
    max_tokens: 300,
    temperature: 0.7,
  });
  
  return response.choices[0]?.message?.content || 'Unable to generate suggestions.';
}
