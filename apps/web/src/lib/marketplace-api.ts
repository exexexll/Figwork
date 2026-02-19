// Marketplace API client functions

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  token?: string;
}

async function apiFetch<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  const headers: HeadersInit = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'API request failed');
  }

  return data;
}

// ====================
// STUDENT API
// ====================

export interface StudentProfile {
  id: string;
  clerkId: string;
  email: string;
  phone: string | null;
  name: string;
  kycStatus: string;
  taxStatus: string;
  contractStatus: string;
  stripeConnectStatus: string;
  tier: string;
  totalExp: number;
  tasksCompleted: number;
  avgQualityScore: number;
  onTimeRate: number;
  skillTags: string[];
  specializations: string[];
}

export interface StudentFile {
  id: string;
  filename: string;
  fileType: string;
  category: string;
  cloudinaryUrl: string;
  uploadedAt: string;
}

export interface WorkUnit {
  id: string;
  title: string;
  spec: string;
  category: string;
  priceInCents: number;
  deadlineHours: number;
  requiredSkills: string[];
  complexityScore: number;
  minTier: string;
  status: string;
  company?: { companyName: string; website?: string };
  infoCollectionTemplateId?: string | null;
  assignmentMode?: string;
  acceptanceCriteria?: Array<{ criterion: string; required: boolean }>;
  deliverableFormat?: string[];
  revisionLimit?: number;
  matchScore?: number;
  estimatedPayout?: number;
}

export interface Execution {
  id: string;
  workUnitId: string;
  status: string;
  assignedAt: string;
  deadlineAt: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  qualityScore: number | null;
  expEarned: number;
  infoSessionId?: string | null;
  workUnit?: WorkUnit;
  milestones?: TaskMilestone[];
  // Populated when accepting a task with screening requirement
  requiresScreening?: boolean;
  isManualReview?: boolean;
  interviewLink?: string | null;
}

export interface TaskMilestone {
  id: string;
  description: string;
  completedAt: string | null;
  payoutPercentage: number;
  orderIndex: number;
}

export interface POWLog {
  id: string;
  executionId: string;
  requestedAt: string;
  respondedAt: string | null;
  status: string;
  execution?: { workUnit: { title: string } };
}

export interface Payout {
  id: string;
  amountInCents: number;
  status: string;
  createdAt: string;
  processedAt: string | null;
  executions?: Execution[];
}

export interface Dispute {
  id: string;
  executionId: string;
  reason: string;
  status: string;
  filedAt: string;
  resolvedAt: string | null;
}

// Student Registration
export async function registerStudent(
  data: { email: string; name: string; phone: string; skillTags?: string[] },
  token: string
) {
  return apiFetch<{ id: string; nextStep: string; message: string }>('/api/students/register', {
    method: 'POST',
    body: data,
    token,
  });
}

// Get current student profile
export async function getStudentProfile(token: string) {
  return apiFetch<StudentProfile>('/api/students/me', { token });
}

// Update student profile
export async function updateStudentProfile(
  data: Partial<Pick<StudentProfile, 'name' | 'phone' | 'skillTags' | 'specializations'>>,
  token: string
) {
  return apiFetch<StudentProfile>('/api/students/me', {
    method: 'PUT',
    body: data,
    token,
  });
}

// Phone verification
export async function verifyStudentPhone(code: string, token: string) {
  return apiFetch<{ verified: boolean; nextStep: string }>('/api/students/verify-phone', {
    method: 'POST',
    body: { code },
    token,
  });
}

// KYC session
export async function getKYCSession(token: string) {
  return apiFetch<{ clientSecret: string; sessionId: string }>('/api/students/kyc/session', { token });
}

// Tax form
export async function getTaxForm(token: string) {
  return apiFetch<{ formType: string; stripeUrl: string }>('/api/students/tax/form', { token });
}

// Contract signing
export async function getContractUrl(token: string) {
  return apiFetch<{ signingUrl: string; envelopeId: string }>('/api/students/contract', { token });
}

// Stripe Connect onboarding
export async function getStripeConnectUrl(token: string) {
  return apiFetch<{ url: string; accountId: string }>('/api/students/connect/onboard', { token });
}

// Student files
export async function getStudentFiles(token: string) {
  return apiFetch<StudentFile[]>('/api/students/me/files', { token });
}

export async function uploadStudentFile(
  data: { filename: string; fileType: string; category: string },
  token: string
) {
  return apiFetch<{ uploadUrl: string; publicId: string; fileId: string }>('/api/students/me/files', {
    method: 'POST',
    body: data,
    token,
  });
}

export async function deleteStudentFile(fileId: string, token: string) {
  return apiFetch<void>(`/api/students/me/files/${fileId}`, { method: 'DELETE', token });
}

// Available tasks
export async function getAvailableTasks(token: string) {
  return apiFetch<{ tasks: WorkUnit[]; matchScores: Record<string, number> }>('/api/students/me/tasks', { token });
}

// Single task detail (student view)
export interface TaskDetail extends WorkUnit {
  matchScore: number;
  estimatedPayout: number;
  milestoneTemplates?: Array<{ id: string; description: string; expectedCompletion: number; orderIndex: number }>;
  acceptanceCriteria: Array<{ criterion: string; required: boolean }>;
  deliverableFormat: string[];
  assignmentMode: string;
  requiresScreening: boolean;
  eligibility: {
    eligible: boolean;
    meetsComplexity: boolean;
    meetsTier: boolean;
    alreadyAccepted: boolean;
    skillMatch: string[];
    missingSkills: string[];
  };
}

export async function getTaskDetail(id: string, token: string) {
  return apiFetch<TaskDetail>(`/api/students/me/tasks/${id}`, { token });
}

// Student executions
export async function getStudentExecutions(token: string) {
  return apiFetch<Execution[]>('/api/students/me/executions', { token });
}

export async function getStudentExecution(id: string, token: string) {
  return apiFetch<Execution>(`/api/students/me/executions/${id}`, { token });
}

// POW
export async function getPendingPOW(token: string) {
  return apiFetch<POWLog[]>('/api/pow/pending', { token });
}

export async function submitPOW(
  powId: string,
  data: { workPhotoUrl: string; selfiePhotoUrl: string; progressDescription?: string },
  token: string
) {
  return apiFetch<POWLog>(`/api/pow/${powId}/submit`, {
    method: 'POST',
    body: data,
    token,
  });
}

export async function getPOWHistory(token: string, limit = 20, offset = 0) {
  return apiFetch<{ logs: POWLog[]; stats: Record<string, number> }>(
    `/api/pow/history?limit=${limit}&offset=${offset}`,
    { token }
  );
}

// Payouts
export async function getStudentPayouts(token: string, status?: string) {
  const params = status ? `?status=${status}` : '';
  return apiFetch<Payout[]>(`/api/students/me/payouts${params}`, { token });
}

// Disputes
export async function getStudentDisputes(token: string) {
  return apiFetch<Dispute[]>('/api/students/me/disputes', { token });
}

export async function fileDispute(
  data: { executionId: string; reason: string; evidenceUrls?: string[] },
  token: string
) {
  return apiFetch<Dispute>('/api/students/me/disputes', {
    method: 'POST',
    body: data,
    token,
  });
}

// Screening interview link (for unlocking more tasks)
export async function getScreeningLink(token: string) {
  return apiFetch<{ interviewUrl: string }>('/api/students/screening-link', { token });
}

// ====================
// EXECUTION API
// ====================

export async function acceptTask(workUnitId: string, token: string) {
  return apiFetch<Execution>('/api/executions/accept', {
    method: 'POST',
    body: { workUnitId },
    token,
  });
}

export async function clockIn(executionId: string, token: string) {
  return apiFetch<{ clockedInAt: string; nextPOWAt: string; powFrequencyMinutes: number }>(
    `/api/executions/${executionId}/clock-in`,
    { method: 'POST', token }
  );
}

export async function clockOut(executionId: string, token: string) {
  return apiFetch<{ clockedOutAt: string; sessionMinutes: number }>(
    `/api/executions/${executionId}/clock-out`,
    { method: 'POST', token }
  );
}

export async function submitDeliverables(
  executionId: string,
  data: { deliverableUrls: string[]; submissionNotes?: string },
  token: string
) {
  return apiFetch<Execution>(`/api/executions/${executionId}/submit`, {
    method: 'POST',
    body: data,
    token,
  });
}

export async function completeMilestone(
  executionId: string,
  milestoneId: string,
  data: { evidenceUrl?: string; notes?: string },
  token: string
) {
  return apiFetch<TaskMilestone>(`/api/executions/${executionId}/milestones/${milestoneId}/complete`, {
    method: 'POST',
    body: data,
    token,
  });
}

export async function getExecution(executionId: string, token: string) {
  return apiFetch<Execution>(`/api/executions/${executionId}`, { token });
}

export async function getExecutionRevisions(executionId: string, token: string) {
  return apiFetch<any[]>(`/api/executions/${executionId}/revisions`, { token });
}

// ====================
// COMPANY API
// ====================

export interface CompanyProfile {
  id: string;
  userId: string;
  companyName: string;
  email: string;
  legalName: string | null;
  ein: string | null;
  website: string | null;
  verificationStatus: string;
  contractStatus: string;
  billingMethod: string | null;
  monthlyBudgetCap: number | null;
  stripeCustomerId: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  subtotalInCents: number;
  platformFeesInCents: number;
  totalInCents: number;
  status: string;
  dueAt: string;
  paidAt: string | null;
}

export interface BudgetPeriod {
  id: string;
  month: number;
  year: number;
  budgetCapInCents: number | null;
  totalSpentInCents: number;
  totalEscrowedInCents: number;
  tasksPosted: number;
  tasksCompleted: number;
}

// Company registration
export async function registerCompany(
  data: {
    companyName: string;
    email: string;
    legalName?: string;
    ein?: string;
    website?: string;
    address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
  },
  token: string
) {
  return apiFetch<{ companyId: string; nextStep: string }>('/api/companies/register', {
    method: 'POST',
    body: data,
    token,
  });
}

// Get company profile
export async function getCompanyProfile(token: string) {
  return apiFetch<CompanyProfile>('/api/companies/me', { token });
}

// Update company profile
export async function updateCompanyProfile(data: Partial<CompanyProfile>, token: string) {
  return apiFetch<CompanyProfile>('/api/companies/me', {
    method: 'PUT',
    body: data,
    token,
  });
}

// Billing
export async function getCompanyBilling(token: string) {
  return apiFetch<{
    billingMethod: string | null;
    monthlyBudgetCap: number | null;
    currentMonthSpend: number;
    currentMonthFees: number;
    currentBudgetPeriod: BudgetPeriod | null;
  }>('/api/companies/billing', { token });
}

export async function updateCompanyBilling(
  data: { billingMethod?: string; monthlyBudgetCap?: number },
  token: string
) {
  return apiFetch<CompanyProfile>('/api/companies/billing', {
    method: 'PUT',
    body: data,
    token,
  });
}

// Budget periods
export async function getBudgetPeriods(token: string) {
  return apiFetch<BudgetPeriod[]>('/api/companies/budget-periods', { token });
}

export async function createBudgetPeriod(
  data: { month: number; year: number; budgetCapInCents: number },
  token: string
) {
  return apiFetch<BudgetPeriod>('/api/companies/budget-periods', {
    method: 'POST',
    body: data,
    token,
  });
}

// Invoices
export async function getCompanyInvoices(token: string) {
  return apiFetch<{ invoices: Invoice[]; totalOutstandingInCents: number }>('/api/companies/invoices', { token });
}

export async function getInvoice(invoiceId: string, token: string) {
  return apiFetch<Invoice>(`/api/companies/invoices/${invoiceId}`, { token });
}

export async function payInvoice(invoiceId: string, token: string) {
  return apiFetch<{ checkoutUrl: string }>(`/api/companies/invoices/${invoiceId}/pay`, {
    method: 'POST',
    token,
  });
}

// Analytics
export async function getCompanyAnalytics(token: string) {
  return apiFetch<{
    totalWorkUnits: number;
    completedWorkUnits: number;
    totalSpendInCents: number;
  }>('/api/companies/analytics', { token });
}

// ====================
// WORK UNIT API
// ====================

export interface WorkUnitDetailed extends WorkUnit {
  milestoneTemplates?: Array<{ id: string; description: string; expectedCompletion: number; orderIndex: number }>;
  escrow?: { id: string; status: string; amountInCents: number };
  executions?: Execution[];
  _count?: { executions: number };
}

export interface CreateWorkUnitInput {
  title: string;
  spec: string;
  category: string;
  priceInCents: number;
  deadlineHours: number;
  acceptanceCriteria: Array<{ criterion: string; required: boolean }>;
  deliverableFormat: string[];
  requiredSkills?: string[];
  requiredDocuments?: string[];
  revisionLimit?: number;
  complexityScore?: number;
  minTier?: 'novice' | 'pro' | 'elite';
  exampleUrls?: string[];
  milestones?: Array<{ description: string; expectedCompletion: number }>;
  infoCollectionTemplateId?: string; // Optional screening interview
  assignmentMode?: 'auto' | 'manual'; // Auto-match vs company picks from candidates
}

export interface UpdateWorkUnitInput {
  title?: string;
  spec?: string;
  category?: string;
  priceInCents?: number;
  deadlineHours?: number;
  acceptanceCriteria?: Array<{ criterion: string; required: boolean }>;
  deliverableFormat?: string[];
  requiredSkills?: string[];
  revisionLimit?: number;
  complexityScore?: number;
  minTier?: 'novice' | 'pro' | 'elite';
  assignmentMode?: 'auto' | 'manual';
  infoCollectionTemplateId?: string | null;
  status?: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
  exampleUrls?: string[];
}

// Create work unit
export async function createWorkUnit(data: CreateWorkUnitInput, token: string) {
  return apiFetch<WorkUnitDetailed>('/api/workunits', {
    method: 'POST',
    body: data,
    token,
  });
}

// List work units
export async function getWorkUnits(token: string, status?: string, category?: string) {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (category) params.append('category', category);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<WorkUnitDetailed[]>(`/api/workunits${query}`, { token });
}

// Get single work unit
export async function getWorkUnit(id: string, token: string) {
  return apiFetch<WorkUnitDetailed>(`/api/workunits/${id}`, { token });
}

// Update work unit
export async function updateWorkUnit(id: string, data: UpdateWorkUnitInput, token: string) {
  return apiFetch<WorkUnitDetailed>(`/api/workunits/${id}`, {
    method: 'PUT',
    body: data,
    token,
  });
}

// Delete work unit
export async function deleteWorkUnit(id: string, token: string) {
  return apiFetch<void>(`/api/workunits/${id}`, { method: 'DELETE', token });
}

// Fund escrow
export async function fundWorkUnitEscrow(id: string, token: string) {
  return apiFetch<{ id: string; status: string; fundedAt: string }>(`/api/workunits/${id}/fund-escrow`, {
    method: 'POST',
    body: { confirm: true },
    token,
  });
}

// Get matching candidates
export async function getWorkUnitCandidates(id: string, token: string) {
  return apiFetch<
    Array<{
      id: string;
      name: string;
      tier: string;
      tasksCompleted: number;
      avgQualityScore: number;
      matchScore: number;
    }>
  >(`/api/workunits/${id}/candidates`, { token });
}

// Review execution (company side)
export async function reviewExecution(
  executionId: string,
  data: {
    verdict: 'approved' | 'revision_needed' | 'failed';
    qualityScore?: number;
    feedback?: string;
    revisionIssues?: Array<{ criterion: string; issue: string; suggestion?: string; severity?: string }>;
  },
  token: string
) {
  return apiFetch<Execution>(`/api/executions/${executionId}/review`, {
    method: 'POST',
    body: data,
    token,
  });
}

// ====================
// PAYMENTS API
// ====================

// Student balance
export async function getStudentBalance(token: string) {
  return apiFetch<{
    pendingInCents: number;
    processingInCents: number;
    totalEarnedInCents: number;
    monthlyEarnedInCents: number;
    stripeConnectStatus: string;
    tier: string;
    platformFeePercent: number;
  }>('/api/payments/student/balance', { token });
}

// Request instant payout
export async function requestInstantPayout(token: string) {
  return apiFetch<{
    totalAmountInCents: number;
    feeInCents: number;
    netAmountInCents: number;
    payoutCount: number;
    status: string;
    estimatedArrival: string;
  }>('/api/payments/student/instant-payout', { method: 'POST', token });
}

// Company balance
export async function getCompanyBalance(token: string) {
  return apiFetch<{
    activeEscrowInCents: number;
    pendingEscrowInCents: number;
    monthlySpendInCents: number;
    monthlyFeesInCents: number;
    budgetCapInCents: number | null;
    budgetRemainingInCents: number | null;
  }>('/api/payments/company/balance', { token });
}

// Add company funds
export async function addCompanyFunds(amountInCents: number, token: string) {
  return apiFetch<{ checkoutUrl: string; amountInCents: number }>('/api/payments/company/add-funds', {
    method: 'POST',
    body: { amountInCents },
    token,
  });
}

// ====================
// COMPANY DISPUTES
// ====================

export interface CompanyDispute {
  id: string;
  executionId: string | null;
  studentId: string;
  filedBy: string;
  reason: string;
  status: string;
  resolution: string | null;
  filedAt: string;
  resolvedAt: string | null;
  workUnitTitle: string | null;
  student: { name: string; tier: string };
}

export async function getCompanyDisputes(token: string) {
  return apiFetch<{ disputes: CompanyDispute[] }>('/api/companies/disputes', { token });
}

export async function fileCompanyDispute(
  data: { executionId: string; reason: string; evidenceUrls?: string[] },
  token: string
) {
  return apiFetch<CompanyDispute>('/api/companies/disputes', {
    method: 'POST',
    body: data,
    token,
  });
}

// ====================
// REVIEW QUEUE
// ====================

export async function getReviewQueue(token: string, status: string = 'submitted') {
  return apiFetch<{ executions: any[] }>(`/api/executions/review-queue?status=${status}`, { token });
}

// ====================
// ONBOARDING CONFIG API
// ====================

export interface OnboardingStepConfig {
  id: string;
  stepType: string;
  label: string;
  description: string | null;
  icon: string | null;
  required: boolean;
  gateLevel: string;
  completed: boolean;
  needsResign: boolean;
  agreement?: {
    id: string;
    title: string;
    slug: string;
    version: number;
    status: string;
    content?: string;
  } | null;
}

export interface OnboardingActiveResponse {
  steps: OnboardingStepConfig[];
  gateStatus: {
    browse: boolean;
    accept: boolean;
    payout: boolean;
  };
}

export interface LegalAgreementFull {
  id: string;
  title: string;
  slug: string;
  content: string;
  version: number;
  requiresResign: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count?: { signatures: number };
}

export interface AdminOnboardingStep {
  id: string;
  stepType: string;
  label: string;
  description: string | null;
  icon: string | null;
  enabled: boolean;
  required: boolean;
  orderIndex: number;
  gateLevel: string;
  agreementId: string | null;
  config: Record<string, unknown> | null;
  agreement?: {
    id: string;
    title: string;
    slug: string;
    version: number;
    status: string;
  } | null;
}

// Student: get active onboarding config
export async function getActiveOnboardingConfig(token: string) {
  return apiFetch<OnboardingActiveResponse>('/api/onboarding-config/active', { token });
}

// Student: sign agreement
export async function signAgreement(agreementId: string, signedName: string, token: string) {
  return apiFetch<{ signature: { id: string; signedAt: string }; message: string }>(
    `/api/onboarding-config/agreements/${agreementId}/sign`,
    { method: 'POST', body: { signedName }, token }
  );
}

// Student: get onboarding status
export async function getOnboardingStatus(token: string) {
  return apiFetch<{
    hasProfile: boolean;
    completedSteps: string[];
    pendingRequired?: string[];
    canBrowse: boolean;
    canAccept: boolean;
    canGetPaid: boolean;
  }>('/api/onboarding-config/my-status', { token });
}

// Admin: list all steps
export async function getAdminOnboardingSteps(token: string) {
  return apiFetch<{ steps: AdminOnboardingStep[] }>('/api/onboarding-config/steps', { token });
}

// Admin: create step
export async function createOnboardingStep(
  data: {
    stepType: string;
    label: string;
    description?: string;
    icon?: string;
    enabled?: boolean;
    required?: boolean;
    gateLevel?: string;
    agreementId?: string;
    config?: Record<string, unknown>;
  },
  token: string
) {
  return apiFetch<{ step: AdminOnboardingStep }>('/api/onboarding-config/steps', {
    method: 'POST',
    body: data,
    token,
  });
}

// Admin: update step
export async function updateOnboardingStep(
  id: string,
  data: Partial<{
    label: string;
    description: string;
    icon: string;
    enabled: boolean;
    required: boolean;
    gateLevel: string;
    agreementId: string;
    config: Record<string, unknown>;
  }>,
  token: string
) {
  return apiFetch<{ step: AdminOnboardingStep }>(`/api/onboarding-config/steps/${id}`, {
    method: 'PUT',
    body: data,
    token,
  });
}

// Admin: reorder steps
export async function reorderOnboardingSteps(
  order: Array<{ id: string; orderIndex: number }>,
  token: string
) {
  return apiFetch<{ steps: AdminOnboardingStep[] }>('/api/onboarding-config/steps/reorder', {
    method: 'POST',
    body: { order },
    token,
  });
}

// Admin: delete step
export async function deleteOnboardingStep(id: string, token: string) {
  return apiFetch<void>(`/api/onboarding-config/steps/${id}`, { method: 'DELETE', token });
}

// Admin: list agreements
export async function getAdminAgreements(token: string) {
  return apiFetch<{ agreements: LegalAgreementFull[] }>('/api/onboarding-config/agreements', {
    token,
  });
}

// Admin: create agreement
export async function createAgreement(
  data: { title: string; slug: string; content: string; status?: string },
  token: string
) {
  return apiFetch<{ agreement: LegalAgreementFull }>('/api/onboarding-config/agreements', {
    method: 'POST',
    body: data,
    token,
  });
}

// Admin: update agreement
export async function updateAgreement(
  id: string,
  data: { title?: string; content?: string; status?: string; bumpVersion?: boolean },
  token: string
) {
  return apiFetch<{ agreement: LegalAgreementFull }>(
    `/api/onboarding-config/agreements/${id}`,
    { method: 'PUT', body: data, token }
  );
}

// Admin: get agreement detail
export async function getAdminAgreement(id: string, token: string) {
  return apiFetch<{ agreement: LegalAgreementFull & { signatures: any[] } }>(
    `/api/onboarding-config/agreements/${id}`,
    { token }
  );
}

// Admin: archive agreement
export async function archiveAgreement(id: string, token: string) {
  return apiFetch<void>(`/api/onboarding-config/agreements/${id}`, {
    method: 'DELETE',
    token,
  });
}
