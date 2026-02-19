/**
 * Requirements Verifier - Pre-assignment verification for work units
 * 
 * Checks:
 * 1. Tier eligibility
 * 2. Skill requirements
 * 3. Required documents
 * 4. Required fields/info
 * 5. Legal compliance (contracts, tax)
 * 6. Performance requirements
 */

import { db } from '@figwork/db';
import { checkWorkUnitEligibility, getTrustStatus } from './trust-gates.js';

export interface VerificationCheck {
  name: string;
  passed: boolean;
  required: boolean;
  message?: string;
  action?: string; // What user should do
  redirectTo?: string; // Where to redirect for fixing
}

export interface VerificationResult {
  eligible: boolean;
  needsInterview: boolean;
  missingFields: string[];
  checks: VerificationCheck[];
  blockers: string[];
}

/**
 * Check 1: Tier eligibility via trust gates
 */
async function checkTierEligibility(
  studentId: string,
  workUnit: { priceInCents: number; deadlineHours: number; category: string; minTier: string }
): Promise<VerificationCheck> {
  const result = await checkWorkUnitEligibility(studentId, workUnit);

  return {
    name: 'tierEligibility',
    passed: result.eligible,
    required: true,
    message: result.eligible
      ? `Eligible at ${result.gate} gate`
      : result.reason,
    action: result.eligible ? undefined : 'Complete more tasks to advance your tier',
    redirectTo: result.eligible ? undefined : '/student/profile',
  };
}

/**
 * Check 2: Skill requirements
 */
async function checkSkillRequirements(
  studentId: string,
  requiredSkills: string[]
): Promise<VerificationCheck> {
  if (requiredSkills.length === 0) {
    return {
      name: 'skillRequirements',
      passed: true,
      required: false,
      message: 'No specific skills required',
    };
  }

  const student = await db.studentProfile.findUnique({
    where: { id: studentId },
    select: { skillTags: true },
  });

  const studentSkills = (student?.skillTags || []).map((s: string) => s.toLowerCase());
  const matchedSkills = requiredSkills.filter((skill: string) =>
    studentSkills.some((s: string) => s.includes(skill.toLowerCase()) || skill.toLowerCase().includes(s))
  );

  const matchRatio = matchedSkills.length / requiredSkills.length;
  const passed = matchRatio >= 0.5; // At least 50% skill match

  return {
    name: 'skillRequirements',
    passed,
    required: false, // Not a hard blocker
    message: passed
      ? `Skills matched: ${matchedSkills.join(', ')}`
      : `Missing skills: ${requiredSkills.filter((s: string) => !matchedSkills.includes(s)).join(', ')}`,
    action: passed ? undefined : 'Update your skills in your profile',
    redirectTo: passed ? undefined : '/student/profile',
  };
}

/**
 * Check 3: Required documents
 */
async function checkRequiredDocuments(
  studentId: string,
  requiredDocumentTypes: string[]
): Promise<VerificationCheck> {
  if (requiredDocumentTypes.length === 0) {
    return {
      name: 'requiredDocuments',
      passed: true,
      required: false,
      message: 'No documents required',
    };
  }

  const studentFiles = await db.studentFile.findMany({
    where: {
      studentId,
      fileType: { in: requiredDocumentTypes },
    },
    select: { fileType: true },
  });

  const uploadedTypes = studentFiles.map((f: { fileType: string }) => f.fileType);
  const missingTypes = requiredDocumentTypes.filter((t: string) => !uploadedTypes.includes(t));
  const passed = missingTypes.length === 0;

  return {
    name: 'requiredDocuments',
    passed,
    required: true,
    message: passed
      ? 'All required documents uploaded'
      : `Missing documents: ${missingTypes.join(', ')}`,
    action: passed ? undefined : 'Upload required documents',
    redirectTo: passed ? undefined : '/student/profile?tab=library',
  };
}

/**
 * Check 4: Required fields/info via interview
 * If a work unit has requiredFields, the student may need to complete a screening interview
 */
async function checkRequiredFields(
  _studentId: string,
  _workUnitId: string,
  requiredFields: Array<{ name: string; description: string }>
): Promise<VerificationCheck & { needsInterview: boolean; missingFields: string[] }> {
  if (requiredFields.length === 0) {
    return {
      name: 'requiredFields',
      passed: true,
      required: false,
      message: 'No additional information required',
      needsInterview: false,
      missingFields: [],
    };
  }

  // If requiredFields are present, the student needs a screening interview to collect them
  // In production, we'd check if the info was already collected from a previous session
  return {
    name: 'requiredFields',
    passed: false,
    required: true,
    message: `Need to collect: ${requiredFields.map((f: { name: string }) => f.name).join(', ')}`,
    action: 'Complete screening interview to provide required information',
    redirectTo: `/student/screening/${_workUnitId}`,
    needsInterview: true,
    missingFields: requiredFields.map((f: { name: string }) => f.name),
  };
}

/**
 * Check 5: Legal compliance
 */
async function checkLegalCompliance(studentId: string): Promise<VerificationCheck> {
  const student = await db.studentProfile.findUnique({
    where: { id: studentId },
    select: {
      kycStatus: true,
      taxStatus: true,
      contractStatus: true,
    },
  });

  if (!student) {
    return {
      name: 'legalCompliance',
      passed: false,
      required: true,
      message: 'Profile not found',
    };
  }

  const issues: string[] = [];

  if (student.kycStatus !== 'verified') {
    issues.push('KYC verification incomplete');
  }
  if (!['submitted', 'verified'].includes(student.taxStatus)) {
    issues.push('Tax form not submitted');
  }
  if (student.contractStatus !== 'signed') {
    issues.push('Platform contract not signed');
  }

  const passed = issues.length === 0;

  return {
    name: 'legalCompliance',
    passed,
    required: true,
    message: passed ? 'All legal requirements met' : issues.join(', '),
    action: passed ? undefined : 'Complete onboarding requirements',
    redirectTo: passed ? undefined : '/student/onboarding',
  };
}

/**
 * Check 6: Performance requirements
 */
async function checkPerformanceRequirements(
  studentId: string,
  requirements?: { minQualityScore?: number; minOnTimeRate?: number; maxRevisionRate?: number }
): Promise<VerificationCheck> {
  const trustStatus = await getTrustStatus(studentId);

  if (!trustStatus) {
    return {
      name: 'performanceRequirements',
      passed: false,
      required: true,
      message: 'Could not verify performance',
    };
  }

  const { avgQualityScore, onTimeRate, revisionRate } = trustStatus.qualifyingMetrics;

  // Default minimums based on trust gate
  const defaults = {
    minQualityScore: trustStatus.gate === 'novice_probation' ? 0 : 0.6,
    minOnTimeRate: trustStatus.gate === 'novice_probation' ? 0 : 0.7,
    maxRevisionRate: trustStatus.gate === 'novice_probation' ? 1 : 0.5,
  };

  const minQuality = requirements?.minQualityScore ?? defaults.minQualityScore;
  const minOnTime = requirements?.minOnTimeRate ?? defaults.minOnTimeRate;
  const maxRevision = requirements?.maxRevisionRate ?? defaults.maxRevisionRate;

  const issues: string[] = [];

  if (avgQualityScore < minQuality && trustStatus.tasksCompleted > 5) {
    issues.push(`Quality score ${Math.round(avgQualityScore * 100)}% below ${Math.round(minQuality * 100)}%`);
  }
  if (onTimeRate < minOnTime && trustStatus.tasksCompleted > 5) {
    issues.push(`On-time rate ${Math.round(onTimeRate * 100)}% below ${Math.round(minOnTime * 100)}%`);
  }
  if (revisionRate > maxRevision && trustStatus.tasksCompleted > 5) {
    issues.push(`Revision rate ${Math.round(revisionRate * 100)}% exceeds ${Math.round(maxRevision * 100)}%`);
  }

  const passed = issues.length === 0;

  return {
    name: 'performanceRequirements',
    passed,
    required: false, // Performance issues are warnings, not blockers
    message: passed ? 'Performance meets requirements' : issues.join(', '),
    action: passed ? undefined : 'Improve quality metrics by completing tasks carefully',
  };
}

/**
 * Run all verification checks for a student accepting a work unit
 */
export async function verifyRequirements(
  studentId: string,
  workUnit: {
    id: string;
    priceInCents: number;
    deadlineHours: number;
    category: string;
    minTier: string;
    requiredSkills: string[];
    requiredDocuments?: string[];
    requiredFields?: Array<{ name: string; description: string }>;
    performanceRequirements?: {
      minQualityScore?: number;
      minOnTimeRate?: number;
      maxRevisionRate?: number;
    };
  }
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  const blockers: string[] = [];
  let needsInterview = false;
  let missingFields: string[] = [];

  // Run all checks
  const tierCheck = await checkTierEligibility(studentId, workUnit);
  checks.push(tierCheck);
  if (!tierCheck.passed && tierCheck.required) {
    blockers.push(tierCheck.message || 'Tier eligibility failed');
  }

  const skillCheck = await checkSkillRequirements(studentId, workUnit.requiredSkills);
  checks.push(skillCheck);

  const docCheck = await checkRequiredDocuments(studentId, workUnit.requiredDocuments || []);
  checks.push(docCheck);
  if (!docCheck.passed && docCheck.required) {
    blockers.push(docCheck.message || 'Missing required documents');
  }

  const fieldCheck = await checkRequiredFields(
    studentId,
    workUnit.id,
    workUnit.requiredFields || []
  );
  checks.push(fieldCheck);
  if (!fieldCheck.passed && fieldCheck.required) {
    blockers.push(fieldCheck.message || 'Missing required information');
  }
  needsInterview = fieldCheck.needsInterview;
  missingFields = fieldCheck.missingFields;

  const legalCheck = await checkLegalCompliance(studentId);
  checks.push(legalCheck);
  if (!legalCheck.passed && legalCheck.required) {
    blockers.push(legalCheck.message || 'Legal compliance issues');
  }

  const perfCheck = await checkPerformanceRequirements(studentId, workUnit.performanceRequirements);
  checks.push(perfCheck);
  // Performance issues don't block, just warn

  const eligible = blockers.length === 0;

  return {
    eligible,
    needsInterview,
    missingFields,
    checks,
    blockers,
  };
}

/**
 * Quick eligibility check without full verification
 */
export async function quickEligibilityCheck(
  studentId: string,
  workUnitId: string
): Promise<{ eligible: boolean; reason?: string }> {
  const workUnit = await db.workUnit.findUnique({
    where: { id: workUnitId },
    select: {
      priceInCents: true,
      deadlineHours: true,
      category: true,
      minTier: true,
    },
  });

  if (!workUnit) {
    return { eligible: false, reason: 'Work unit not found' };
  }

  const tierResult = await checkWorkUnitEligibility(studentId, workUnit);
  if (!tierResult.eligible) {
    return { eligible: false, reason: tierResult.reason };
  }

  const legalCheck = await checkLegalCompliance(studentId);
  if (!legalCheck.passed) {
    return { eligible: false, reason: legalCheck.message };
  }

  return { eligible: true };
}
