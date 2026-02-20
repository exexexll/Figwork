/**
 * Agent Tools — functions the AI agent can call via OpenAI function calling.
 * Each wraps existing Prisma queries. No new business logic.
 */

import { db } from '@figwork/db';
import { PRICING_CONFIG, TIER_CONFIG } from '@figwork/shared';

// Tool definitions for OpenAI function calling
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'create_work_unit',
      description: 'Create a new task/work unit for contractors to complete',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          spec: { type: 'string', description: 'Detailed task description and requirements' },
          category: { type: 'string', description: 'Task category (e.g. writing, design, research, data-entry)' },
          priceInCents: { type: 'number', description: 'Payment amount in cents (e.g. 2500 = $25)' },
          deadlineHours: { type: 'number', description: 'Hours to complete after acceptance' },
          requiredSkills: { type: 'array', items: { type: 'string' }, description: 'Required skills' },
          acceptanceCriteria: {
            type: 'array',
            items: { type: 'object', properties: { criterion: { type: 'string' }, required: { type: 'boolean' } } },
            description: 'What defines acceptable work',
          },
          deliverableFormat: { type: 'array', items: { type: 'string' }, description: 'Expected deliverable formats (e.g. PDF, Google Doc)' },
          requiredDocuments: { type: 'array', items: { type: 'string' }, description: 'Documents contractor must provide (e.g. resume, portfolio)' },
          minTier: { type: 'string', enum: ['novice', 'pro', 'elite'], description: 'Minimum contractor tier' },
          complexityScore: { type: 'number', description: 'Task complexity 1-5' },
          revisionLimit: { type: 'number', description: 'Max revisions allowed' },
          assignmentMode: { type: 'string', enum: ['auto', 'manual'], description: 'auto = system assigns best match, manual = you pick from candidates' },
          exampleUrls: { type: 'array', items: { type: 'string' }, description: 'URLs to example deliverables' },
          interviewTemplateId: { type: 'string', description: 'ID of screening interview template to attach' },
        },
        required: ['title', 'spec', 'category', 'priceInCents', 'deadlineHours'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_work_unit',
      description: 'Update an existing work unit. Can change any field.',
      parameters: {
        type: 'object',
        properties: {
          workUnitId: { type: 'string', description: 'Work unit ID' },
          title: { type: 'string' },
          spec: { type: 'string' },
          category: { type: 'string' },
          status: { type: 'string', enum: ['active', 'paused', 'cancelled'] },
          priceInCents: { type: 'number' },
          deadlineHours: { type: 'number' },
          requiredSkills: { type: 'array', items: { type: 'string' } },
          deliverableFormat: { type: 'array', items: { type: 'string' } },
          acceptanceCriteria: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, required: { type: 'boolean' } } } },
          minTier: { type: 'string', enum: ['novice', 'pro', 'elite'] },
          complexityScore: { type: 'number' },
          revisionLimit: { type: 'number' },
          assignmentMode: { type: 'string', enum: ['auto', 'manual'] },
          exampleUrls: { type: 'array', items: { type: 'string' } },
          interviewTemplateId: { type: 'string', description: 'Screening interview template ID, or empty to remove' },
        },
        required: ['workUnitId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'estimate_cost',
      description: 'Estimate total cost for a campaign of tasks',
      parameters: {
        type: 'object',
        properties: {
          taskCount: { type: 'number', description: 'Number of tasks' },
          pricePerTaskCents: { type: 'number', description: 'Price per task in cents' },
        },
        required: ['taskCount', 'pricePerTaskCents'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'draft_sow',
      description: 'Generate a statement of work / contract draft based on task details',
      parameters: {
        type: 'object',
        properties: {
          projectName: { type: 'string' },
          scope: { type: 'string', description: 'What work needs to be done' },
          deliverables: { type: 'array', items: { type: 'string' } },
          timeline: { type: 'string' },
          budget: { type: 'string' },
        },
        required: ['projectName', 'scope'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_work_units',
      description: 'List all work units for this company with their current status',
      parameters: { type: 'object', properties: { status: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_candidates',
      description: 'Show matched contractors for a specific work unit',
      parameters: {
        type: 'object',
        properties: { workUnitId: { type: 'string' } },
        required: ['workUnitId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'assign_student',
      description: 'Assign a specific contractor to a work unit',
      parameters: {
        type: 'object',
        properties: {
          workUnitId: { type: 'string' },
          studentId: { type: 'string' },
        },
        required: ['workUnitId', 'studentId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'review_submission',
      description: 'Review a submitted execution — approve, request revision, or reject',
      parameters: {
        type: 'object',
        properties: {
          executionId: { type: 'string' },
          verdict: { type: 'string', enum: ['approved', 'revision_needed', 'failed'] },
          feedback: { type: 'string' },
          qualityScore: { type: 'number', description: '0-100' },
        },
        required: ['executionId', 'verdict'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_execution_status',
      description: 'Get detailed status of an execution including milestones and POW logs',
      parameters: {
        type: 'object',
        properties: { executionId: { type: 'string' } },
        required: ['executionId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fund_escrow',
      description: 'Fund the escrow for a work unit so it can be assigned',
      parameters: {
        type: 'object',
        properties: { workUnitId: { type: 'string' } },
        required: ['workUnitId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_billing',
      description: 'Get billing summary — spending, invoices, budget status',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_interview',
      description: 'Create a screening interview template',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          personaPrompt: { type: 'string', description: 'How the AI interviewer should behave' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                rubric: { type: 'string' },
              },
            },
          },
          timeLimitMinutes: { type: 'number' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'publish_work_unit',
      description: 'Fund escrow and set work unit to active in one step so it appears to contractors',
      parameters: {
        type: 'object',
        properties: { workUnitId: { type: 'string' } },
        required: ['workUnitId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_work_unit',
      description: 'Delete a work unit (only if draft or cancelled)',
      parameters: {
        type: 'object',
        properties: { workUnitId: { type: 'string' } },
        required: ['workUnitId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_milestones',
      description: 'Add milestone checkpoints to a work unit',
      parameters: {
        type: 'object',
        properties: {
          workUnitId: { type: 'string' },
          milestones: {
            type: 'array',
            items: { type: 'object', properties: { description: { type: 'string' }, expectedCompletion: { type: 'number', description: '0-1 fraction of total time' } } },
          },
        },
        required: ['workUnitId', 'milestones'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_sessions',
      description: 'List recent interview sessions and their results',
      parameters: { type: 'object', properties: { limit: { type: 'number' } } },
    },
  },
  // --- Interview Management ---
  { type: 'function' as const, function: { name: 'list_interviews', description: 'List all interview templates', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'get_interview_detail', description: 'Get full interview template with questions, links, and settings', parameters: { type: 'object', properties: { templateId: { type: 'string' } }, required: ['templateId'] } } },
  { type: 'function' as const, function: { name: 'update_interview', description: 'Update interview template settings (persona, tone, voice, time limit, mode)', parameters: { type: 'object', properties: { templateId: { type: 'string' }, name: { type: 'string' }, personaPrompt: { type: 'string' }, toneGuidance: { type: 'string' }, timeLimitMinutes: { type: 'number' }, enableVoiceOutput: { type: 'boolean' }, voiceId: { type: 'string' }, mode: { type: 'string', enum: ['application', 'inquiry'] } }, required: ['templateId'] } } },
  { type: 'function' as const, function: { name: 'delete_interview', description: 'Delete an interview template', parameters: { type: 'object', properties: { templateId: { type: 'string' } }, required: ['templateId'] } } },
  { type: 'function' as const, function: { name: 'add_question', description: 'Add a question to an interview template', parameters: { type: 'object', properties: { templateId: { type: 'string' }, text: { type: 'string' }, rubric: { type: 'string' } }, required: ['templateId', 'text'] } } },
  { type: 'function' as const, function: { name: 'update_question', description: 'Edit a question', parameters: { type: 'object', properties: { questionId: { type: 'string' }, text: { type: 'string' }, rubric: { type: 'string' } }, required: ['questionId'] } } },
  { type: 'function' as const, function: { name: 'delete_question', description: 'Delete a question from an interview', parameters: { type: 'object', properties: { questionId: { type: 'string' } }, required: ['questionId'] } } },
  { type: 'function' as const, function: { name: 'generate_link', description: 'Generate a shareable interview link', parameters: { type: 'object', properties: { templateId: { type: 'string' }, linkType: { type: 'string', enum: ['one_time', 'permanent'] }, label: { type: 'string' } }, required: ['templateId'] } } },
  { type: 'function' as const, function: { name: 'list_knowledge', description: 'List knowledge files uploaded to an interview template', parameters: { type: 'object', properties: { templateId: { type: 'string' } }, required: ['templateId'] } } },
  { type: 'function' as const, function: { name: 'get_session_detail', description: 'Get full session detail including transcript and summary', parameters: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } } },
  // --- Work Unit Extras ---
  { type: 'function' as const, function: { name: 'get_work_unit_detail', description: 'Get full work unit detail with escrow, executions, milestones', parameters: { type: 'object', properties: { workUnitId: { type: 'string' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'get_improvements', description: 'Get AI improvement suggestions for a work unit', parameters: { type: 'object', properties: { workUnitId: { type: 'string' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'get_work_unit_sessions', description: 'List interview sessions for a work unit', parameters: { type: 'object', properties: { workUnitId: { type: 'string' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'get_qa_results', description: 'Get QA check results for an execution', parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'] } } },
  // --- Execution Tracking ---
  { type: 'function' as const, function: { name: 'list_review_queue', description: 'List all submissions awaiting review', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'get_revisions', description: 'Get revision history for an execution', parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'] } } },
  { type: 'function' as const, function: { name: 'cancel_execution', description: 'Cancel an active execution', parameters: { type: 'object', properties: { executionId: { type: 'string' }, reason: { type: 'string' } }, required: ['executionId'] } } },
  { type: 'function' as const, function: { name: 'get_notifications', description: 'List recent notifications', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function' as const, function: { name: 'get_analytics', description: 'Get company analytics and performance data', parameters: { type: 'object', properties: {} } } },
  // --- Financial ---
  { type: 'function' as const, function: { name: 'list_invoices', description: 'List invoices and payment status', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'pay_invoice', description: 'Pay an outstanding invoice', parameters: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] } } },
  { type: 'function' as const, function: { name: 'set_budget_period', description: 'Set monthly budget cap', parameters: { type: 'object', properties: { month: { type: 'number' }, year: { type: 'number' }, budgetCapInCents: { type: 'number' } }, required: ['month', 'year', 'budgetCapInCents'] } } },
  { type: 'function' as const, function: { name: 'get_transactions', description: 'List payment transactions', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function' as const, function: { name: 'add_funds', description: 'Add funds to company balance', parameters: { type: 'object', properties: { amountInCents: { type: 'number' } }, required: ['amountInCents'] } } },
  { type: 'function' as const, function: { name: 'update_billing', description: 'Update billing method', parameters: { type: 'object', properties: { billingMethod: { type: 'string', enum: ['card', 'ach'] }, monthlyBudgetCap: { type: 'number' } } } } },
  { type: 'function' as const, function: { name: 'generate_contract', description: 'Generate a DocuSign service agreement', parameters: { type: 'object', properties: {} } } },
  // --- Company Management ---
  { type: 'function' as const, function: { name: 'get_company_profile', description: 'View company profile details', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'update_company_profile', description: 'Edit company name, website, address', parameters: { type: 'object', properties: { companyName: { type: 'string' }, legalName: { type: 'string' }, website: { type: 'string' } } } } },
  { type: 'function' as const, function: { name: 'list_disputes', description: 'List disputes', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'file_dispute', description: 'File a dispute against an execution', parameters: { type: 'object', properties: { executionId: { type: 'string' }, reason: { type: 'string' } }, required: ['executionId', 'reason'] } } },
];

// Tool executor — dispatches tool calls to the right function
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  companyId: string,
  userId: string,
): Promise<string> {
  try {
    switch (toolName) {
      case 'create_work_unit':
        return await toolCreateWorkUnit(args, companyId);
      case 'update_work_unit':
        return await toolUpdateWorkUnit(args, companyId);
      case 'estimate_cost':
        return await toolEstimateCost(args);
      case 'draft_sow':
        return await toolDraftSOW(args);
      case 'list_work_units':
        return await toolListWorkUnits(args, companyId);
      case 'list_candidates':
        return await toolListCandidates(args, companyId);
      case 'assign_student':
        return await toolAssignStudent(args, companyId);
      case 'review_submission':
        return await toolReviewSubmission(args, companyId);
      case 'get_execution_status':
        return await toolGetExecutionStatus(args, companyId);
      case 'fund_escrow':
        return await toolFundEscrow(args, companyId);
      case 'get_billing':
        return await toolGetBilling(companyId);
      case 'publish_work_unit':
        return await toolPublishWorkUnit(args, companyId);
      case 'delete_work_unit':
        return await toolDeleteWorkUnit(args, companyId);
      case 'add_milestones':
        return await toolAddMilestones(args, companyId);
      case 'create_interview':
        return await toolCreateInterview(args, userId);
      case 'get_sessions':
        return await toolGetSessions(args, userId);
      // Interview Management
      case 'list_interviews': return await toolListInterviews(userId);
      case 'get_interview_detail': return await toolGetInterviewDetail(args, userId);
      case 'update_interview': return await toolUpdateInterview(args, userId);
      case 'delete_interview': return await toolDeleteInterview(args, userId);
      case 'add_question': return await toolAddQuestion(args, userId);
      case 'update_question': return await toolUpdateQuestion(args, userId);
      case 'delete_question': return await toolDeleteQuestion(args, userId);
      case 'generate_link': return await toolGenerateLink(args, userId);
      case 'list_knowledge': return await toolListKnowledge(args, userId);
      case 'get_session_detail': return await toolGetSessionDetail(args, userId);
      // Work Unit Extras
      case 'get_work_unit_detail': return await toolGetWorkUnitDetail(args, companyId);
      case 'get_improvements': return await toolGetImprovements(args, companyId);
      case 'get_work_unit_sessions': return await toolGetWorkUnitSessions(args, companyId);
      case 'get_qa_results': return await toolGetQAResults(args, companyId);
      // Execution Tracking
      case 'list_review_queue': return await toolListReviewQueue(companyId);
      case 'get_revisions': return await toolGetRevisions(args, companyId);
      case 'cancel_execution': return await toolCancelExecution(args, companyId);
      case 'get_notifications': return await toolGetNotifications(args, companyId);
      case 'get_analytics': return await toolGetAnalytics(companyId);
      // Financial
      case 'list_invoices': return await toolListInvoices(companyId);
      case 'pay_invoice': return await toolPayInvoice(args, companyId);
      case 'set_budget_period': return await toolSetBudgetPeriod(args, companyId);
      case 'get_transactions': return await toolGetTransactions(args, companyId);
      case 'add_funds': return await toolAddFunds(args, companyId);
      case 'update_billing': return await toolUpdateBilling(args, companyId);
      case 'generate_contract': return await toolGenerateContract(companyId);
      // Company Management
      case 'get_company_profile': return await toolGetCompanyProfile(companyId);
      case 'update_company_profile': return await toolUpdateCompanyProfile(args, companyId);
      case 'list_disputes': return await toolListDisputes(companyId);
      case 'file_dispute': return await toolFileDispute(args, companyId);
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err: any) {
    return `Error: ${err.message || 'Tool execution failed'}`;
  }
}

// --- Tool implementations ---

async function toolCreateWorkUnit(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.create({
    data: {
      companyId,
      title: args.title,
      spec: args.spec,
      category: args.category || 'general',
      priceInCents: args.priceInCents || 1000,
      deadlineHours: args.deadlineHours || 24,
      requiredSkills: args.requiredSkills || [],
      acceptanceCriteria: args.acceptanceCriteria || [{ criterion: 'Meets specification', required: true }],
      deliverableFormat: args.deliverableFormat || [],
      requiredDocuments: args.requiredDocuments || [],
      requiredFields: args.requiredFields || null,
      minTier: args.minTier || 'novice',
      complexityScore: args.complexityScore || 1,
      revisionLimit: args.revisionLimit || 2,
      status: 'draft',
      assignmentMode: args.assignmentMode || 'auto',
      hasExamples: !!(args.exampleUrls?.length),
      exampleUrls: args.exampleUrls || [],
      preferredHistory: args.preferredHistory || 0,
      maxRevisionTendency: args.maxRevisionTendency || 0.3,
      infoCollectionTemplateId: args.interviewTemplateId || null,
    },
  });

  // Create escrow
  const feePercent = PRICING_CONFIG.platformFees.novice;
  const feeAmount = Math.round(wu.priceInCents * feePercent);
  await db.escrow.create({
    data: {
      workUnitId: wu.id,
      companyId,
      amountInCents: wu.priceInCents,
      platformFeeInCents: feeAmount,
      netAmountInCents: wu.priceInCents - feeAmount,
      status: 'pending',
    },
  });

  return `Created work unit "${wu.title}" (${wu.id}) — $${(wu.priceInCents / 100).toFixed(2)}, ${wu.deadlineHours}h deadline. Status: draft. Fund escrow and set to active to publish.`;
}

async function toolUpdateWorkUnit(args: any, companyId: string): Promise<string> {
  const { workUnitId, ...updates } = args;
  const wu = await db.workUnit.findFirst({ where: { id: workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';

  const data: any = {};
  const fields = [
    'title', 'spec', 'category', 'status', 'priceInCents', 'deadlineHours',
    'minTier', 'complexityScore', 'revisionLimit', 'assignmentMode',
    'preferredHistory', 'maxRevisionTendency',
  ];
  for (const f of fields) {
    if (updates[f] !== undefined) data[f] = updates[f];
  }
  // Array fields
  if (updates.requiredSkills) data.requiredSkills = updates.requiredSkills;
  if (updates.deliverableFormat) data.deliverableFormat = updates.deliverableFormat;
  if (updates.requiredDocuments) data.requiredDocuments = updates.requiredDocuments;
  if (updates.exampleUrls) { data.exampleUrls = updates.exampleUrls; data.hasExamples = updates.exampleUrls.length > 0; }
  if (updates.acceptanceCriteria) data.acceptanceCriteria = updates.acceptanceCriteria;
  if (updates.interviewTemplateId !== undefined) data.infoCollectionTemplateId = updates.interviewTemplateId;

  if (updates.status === 'active') data.publishedAt = new Date();

  const updated = await db.workUnit.update({ where: { id: workUnitId }, data });

  const changes = Object.keys(data).filter(k => k !== 'publishedAt').join(', ');
  return `Updated "${updated.title}" (${changes}). Status: ${updated.status}, $${(updated.priceInCents / 100).toFixed(2)}.`;
}

async function toolEstimateCost(args: any): Promise<string> {
  const { taskCount, pricePerTaskCents } = args;
  const subtotal = taskCount * pricePerTaskCents;
  const feePercent = PRICING_CONFIG.platformFees.novice; // Use novice rate as default estimate
  const fee = Math.round(subtotal * feePercent);
  const total = subtotal + fee;
  return `${taskCount} tasks at $${(pricePerTaskCents / 100).toFixed(2)} each = $${(subtotal / 100).toFixed(2)} subtotal + $${(fee / 100).toFixed(2)} platform fee (${feePercent * 100}%) = $${(total / 100).toFixed(2)} total.`;
}

async function toolDraftSOW(args: any): Promise<string> {
  const { projectName, scope, deliverables, timeline, budget } = args;
  let sow = `STATEMENT OF WORK\n\nProject: ${projectName}\n\nScope:\n${scope}\n`;
  if (deliverables?.length) sow += `\nDeliverables:\n${deliverables.map((d: string, i: number) => `${i + 1}. ${d}`).join('\n')}\n`;
  if (timeline) sow += `\nTimeline: ${timeline}\n`;
  if (budget) sow += `\nBudget: ${budget}\n`;
  sow += `\nTerms: Payment upon approval of each deliverable. Escrow-protected through Figwork. IP transfers to client upon payment.`;
  return sow;
}

async function toolListWorkUnits(args: any, companyId: string): Promise<string> {
  const where: any = { companyId };
  if (args.status) where.status = args.status;

  const units = await db.workUnit.findMany({
    where,
    select: { id: true, title: true, status: true, priceInCents: true, deadlineHours: true, category: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (units.length === 0) return 'No work units found.';

  return units.map(u =>
    `${u.title} — ${u.status}, $${(u.priceInCents / 100).toFixed(2)}, ${u.deadlineHours}h [${u.id.slice(0, 8)}]`
  ).join('\n');
}

async function toolListCandidates(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({ where: { id: args.workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';

  const students = await db.studentProfile.findMany({
    where: { tier: { in: ['novice', 'pro', 'elite'] } },
    select: { id: true, name: true, tier: true, tasksCompleted: true, avgQualityScore: true, skillTags: true },
    take: 10,
    orderBy: { avgQualityScore: 'desc' },
  });

  if (students.length === 0) return 'No matching candidates found.';

  return students.map(s =>
    `${s.name} — ${s.tier}, ${s.tasksCompleted} tasks, ${Math.round(s.avgQualityScore * 100)}% quality [${s.id.slice(0, 8)}]`
  ).join('\n');
}

async function toolAssignStudent(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({
    where: { id: args.workUnitId, companyId, status: 'active' },
    include: { milestoneTemplates: { orderBy: { orderIndex: 'asc' } } },
  });
  if (!wu) return 'Work unit not found or not active.';

  const student = await db.studentProfile.findUnique({ where: { id: args.studentId } });
  if (!student) return 'Student not found.';

  const deadline = new Date(Date.now() + wu.deadlineHours * 60 * 60 * 1000);

  const exec = await db.execution.create({
    data: {
      workUnitId: wu.id,
      studentId: student.id,
      status: 'assigned',
      deadlineAt: deadline,
      milestones: { create: wu.milestoneTemplates.map(mt => ({ templateId: mt.id })) },
    },
  });

  await db.workUnit.update({ where: { id: wu.id }, data: { status: 'in_progress' } });

  return `Assigned ${student.name} to "${wu.title}". Execution ${exec.id.slice(0, 8)} created, deadline ${deadline.toLocaleDateString()}.`;
}

async function toolReviewSubmission(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findUnique({
    where: { id: args.executionId },
    include: { workUnit: true, student: true },
  });
  if (!exec || exec.workUnit.companyId !== companyId) return 'Execution not found.';
  if (exec.status !== 'submitted') return `Cannot review — current status is ${exec.status}.`;

  const data: any = { status: args.verdict };
  if (args.qualityScore) data.qualityScore = args.qualityScore;
  if (args.verdict === 'approved') data.completedAt = new Date();

  await db.execution.update({ where: { id: args.executionId }, data });

  return `${args.verdict === 'approved' ? 'Approved' : args.verdict === 'revision_needed' ? 'Requested revision for' : 'Rejected'} submission from ${exec.student.name}. ${args.feedback || ''}`;
}

async function toolGetExecutionStatus(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findUnique({
    where: { id: args.executionId },
    include: {
      workUnit: { select: { title: true, companyId: true } },
      student: { select: { name: true } },
      milestones: { include: { template: true } },
      powLogs: { orderBy: { requestedAt: 'desc' }, take: 3 },
    },
  });
  if (!exec || exec.workUnit.companyId !== companyId) return 'Execution not found.';

  let result = `"${exec.workUnit.title}" — ${exec.status}, assigned to ${exec.student.name}`;
  result += `\nDeadline: ${exec.deadlineAt.toLocaleDateString()}`;
  if (exec.clockedInAt) result += `\nClocked in: ${exec.clockedInAt.toLocaleString()}`;

  if (exec.milestones.length > 0) {
    const done = exec.milestones.filter(m => m.completedAt).length;
    result += `\nMilestones: ${done}/${exec.milestones.length} completed`;
  }

  if (exec.powLogs.length > 0) {
    result += `\nRecent POW: ${exec.powLogs.map(p => p.status).join(', ')}`;
  }

  return result;
}

async function toolFundEscrow(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({
    where: { id: args.workUnitId, companyId },
    include: { escrow: true },
  });
  if (!wu) return 'Work unit not found.';
  if (!wu.escrow) return 'No escrow account for this work unit.';
  if (wu.escrow.status === 'funded') return 'Escrow already funded.';

  await db.escrow.update({
    where: { id: wu.escrow.id },
    data: { status: 'funded', fundedAt: new Date() },
  });

  return `Escrow funded for "${wu.title}" — $${(wu.priceInCents / 100).toFixed(2)} held in escrow.`;
}

async function toolGetBilling(companyId: string): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [activeEscrows, completedThisMonth, totalPaid] = await Promise.all([
    db.escrow.aggregate({ where: { companyId, status: 'funded' }, _sum: { amountInCents: true } }),
    db.execution.count({ where: { workUnit: { companyId }, status: 'approved', completedAt: { gte: monthStart } } }),
    db.payout.aggregate({ where: { executions: { some: { workUnit: { companyId } } }, status: 'completed' }, _sum: { amountInCents: true } }),
  ]);

  return `Active escrow: $${((activeEscrows._sum.amountInCents || 0) / 100).toFixed(2)}\nCompleted this month: ${completedThisMonth} tasks\nTotal paid out: $${((totalPaid._sum.amountInCents || 0) / 100).toFixed(2)}`;
}

async function toolPublishWorkUnit(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({
    where: { id: args.workUnitId, companyId },
    include: { escrow: true },
  });
  if (!wu) return 'Work unit not found.';
  if (wu.status === 'active') return `"${wu.title}" is already active.`;

  // Fund escrow if not funded
  if (wu.escrow && wu.escrow.status !== 'funded') {
    await db.escrow.update({
      where: { id: wu.escrow.id },
      data: { status: 'funded', fundedAt: new Date() },
    });
  }

  // Set to active
  await db.workUnit.update({
    where: { id: wu.id },
    data: { status: 'active', publishedAt: new Date() },
  });

  return `Published "${wu.title}" — escrow funded ($${(wu.priceInCents / 100).toFixed(2)}), now visible to contractors.`;
}

async function toolDeleteWorkUnit(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({ where: { id: args.workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';
  if (!['draft', 'cancelled'].includes(wu.status)) {
    return `Cannot delete — status is "${wu.status}". Cancel it first.`;
  }

  await db.workUnit.delete({ where: { id: wu.id } });
  return `Deleted "${wu.title}".`;
}

async function toolAddMilestones(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({ where: { id: args.workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';

  for (let i = 0; i < args.milestones.length; i++) {
    await db.milestoneTemplate.create({
      data: {
        workUnitId: wu.id,
        description: args.milestones[i].description,
        orderIndex: i,
        expectedCompletion: args.milestones[i].expectedCompletion || (i + 1) / (args.milestones.length + 1),
      },
    });
  }

  return `Added ${args.milestones.length} milestones to "${wu.title}".`;
}

async function toolCreateInterview(args: any, userId: string): Promise<string> {
  const template = await db.interviewTemplate.create({
    data: {
      ownerId: userId,
      name: args.name,
      personaPrompt: args.personaPrompt || 'You are a professional interviewer.',
      toneGuidance: null,
      globalFollowupLimit: 3,
      timeLimitMinutes: args.timeLimitMinutes || 30,
    },
  });

  if (args.questions?.length) {
    for (let i = 0; i < args.questions.length; i++) {
      await db.question.create({
        data: {
          templateId: template.id,
          questionText: args.questions[i].text,
          rubric: args.questions[i].rubric || null,
          orderIndex: i,
          maxFollowups: 2,
        },
      });
    }
  }

  return `Created interview template "${template.name}" with ${args.questions?.length || 0} questions. ID: ${template.id.slice(0, 8)}`;
}

async function toolGetSessions(args: any, userId: string): Promise<string> {
  const sessions = await db.interviewSession.findMany({
    where: { template: { ownerId: userId } },
    include: { template: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: args.limit || 10,
  });
  if (sessions.length === 0) return 'No interview sessions found.';
  return sessions.map(s => `${s.template.name} — ${s.status}, ${new Date(s.createdAt).toLocaleDateString()}`).join('\n');
}

// ============================================================
// INTERVIEW MANAGEMENT (10 tools)
// ============================================================

async function toolListInterviews(userId: string): Promise<string> {
  const templates = await db.interviewTemplate.findMany({
    where: { ownerId: userId },
    include: { _count: { select: { questions: true, sessions: true } } },
    orderBy: { createdAt: 'desc' },
  });
  if (templates.length === 0) return 'No interview templates.';
  return templates.map(t => `${t.name} — ${t._count.questions} questions, ${t._count.sessions} sessions, ${t.mode} mode [${t.id.slice(0, 8)}]`).join('\n');
}

async function toolGetInterviewDetail(args: any, userId: string): Promise<string> {
  const t = await db.interviewTemplate.findFirst({
    where: { id: args.templateId, ownerId: userId },
    include: { questions: { orderBy: { orderIndex: 'asc' } }, links: true, knowledgeFiles: true },
  });
  if (!t) return 'Template not found.';
  let r = `"${t.name}" — ${t.mode} mode, ${t.timeLimitMinutes}min limit\nPersona: ${t.personaPrompt?.slice(0, 100)}`;
  if (t.questions.length) r += `\n\nQuestions:\n${t.questions.map((q, i) => `${i + 1}. ${q.questionText}${q.rubric ? ` (rubric: ${q.rubric.slice(0, 60)})` : ''}`).join('\n')}`;
  if (t.links.length) r += `\n\nLinks: ${t.links.filter(l => l.isActive).length} active`;
  if (t.knowledgeFiles.length) r += `\nKnowledge files: ${t.knowledgeFiles.length}`;
  r += `\nVoice: ${t.enableVoiceOutput ? t.voiceId : 'off'}`;
  return r;
}

async function toolUpdateInterview(args: any, userId: string): Promise<string> {
  const { templateId, ...updates } = args;
  const t = await db.interviewTemplate.findFirst({ where: { id: templateId, ownerId: userId } });
  if (!t) return 'Template not found.';
  const data: any = {};
  if (updates.name) data.name = updates.name;
  if (updates.personaPrompt) data.personaPrompt = updates.personaPrompt;
  if (updates.toneGuidance !== undefined) data.toneGuidance = updates.toneGuidance;
  if (updates.timeLimitMinutes) data.timeLimitMinutes = updates.timeLimitMinutes;
  if (updates.enableVoiceOutput !== undefined) data.enableVoiceOutput = updates.enableVoiceOutput;
  if (updates.voiceId) data.voiceId = updates.voiceId;
  if (updates.mode) data.mode = updates.mode;
  const updated = await db.interviewTemplate.update({ where: { id: templateId }, data });
  return `Updated "${updated.name}". ${Object.keys(data).join(', ')} changed.`;
}

async function toolDeleteInterview(args: any, userId: string): Promise<string> {
  const t = await db.interviewTemplate.findFirst({ where: { id: args.templateId, ownerId: userId } });
  if (!t) return 'Template not found.';
  await db.interviewTemplate.delete({ where: { id: args.templateId } });
  return `Deleted "${t.name}".`;
}

async function toolAddQuestion(args: any, userId: string): Promise<string> {
  const t = await db.interviewTemplate.findFirst({ where: { id: args.templateId, ownerId: userId }, include: { _count: { select: { questions: true } } } });
  if (!t) return 'Template not found.';
  const q = await db.question.create({
    data: { templateId: args.templateId, questionText: args.text, rubric: args.rubric || null, orderIndex: t._count.questions, maxFollowups: 2 },
  });
  return `Added question: "${args.text}" to "${t.name}". Now has ${t._count.questions + 1} questions.`;
}

async function toolUpdateQuestion(args: any, userId: string): Promise<string> {
  const q = await db.question.findUnique({ where: { id: args.questionId }, include: { template: true } });
  if (!q || q.template.ownerId !== userId) return 'Question not found.';
  const data: any = {};
  if (args.text) data.questionText = args.text;
  if (args.rubric !== undefined) data.rubric = args.rubric;
  await db.question.update({ where: { id: args.questionId }, data });
  return `Updated question.`;
}

async function toolDeleteQuestion(args: any, userId: string): Promise<string> {
  const q = await db.question.findUnique({ where: { id: args.questionId }, include: { template: true } });
  if (!q || q.template.ownerId !== userId) return 'Question not found.';
  await db.question.delete({ where: { id: args.questionId } });
  return `Deleted question.`;
}

async function toolGenerateLink(args: any, userId: string): Promise<string> {
  const t = await db.interviewTemplate.findFirst({ where: { id: args.templateId, ownerId: userId } });
  if (!t) return 'Template not found.';
  const token = require('crypto').randomBytes(16).toString('hex');
  const link = await db.interviewLink.create({
    data: { templateId: args.templateId, token, linkType: args.linkType || 'permanent', isActive: true },
  });
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `Generated link: ${frontendUrl}/interview/${link.token} (${link.linkType})`;
}

async function toolListKnowledge(args: any, userId: string): Promise<string> {
  const t = await db.interviewTemplate.findFirst({ where: { id: args.templateId, ownerId: userId } });
  if (!t) return 'Template not found.';
  const files = await db.knowledgeFile.findMany({ where: { templateId: args.templateId }, orderBy: { createdAt: 'desc' } });
  if (files.length === 0) return 'No knowledge files uploaded.';
  return files.map(f => `${f.filename} — ${f.status}`).join('\n');
}

async function toolGetSessionDetail(args: any, userId: string): Promise<string> {
  const s: any = await db.interviewSession.findUnique({
    where: { id: args.sessionId },
    include: {
      template: { select: { name: true, ownerId: true } },
      summary: true,
      transcriptMessages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!s || s.template?.ownerId !== userId) return 'Session not found.';
  let r = `"${s.template.name}" session — ${s.status}, ${new Date(s.createdAt).toLocaleDateString()}`;
  if (s.summary?.summaryJson) r += `\n\nSummary: ${JSON.stringify(s.summary.summaryJson).slice(0, 500)}`;
  const msgs = s.transcriptMessages || [];
  if (msgs.length) {
    r += `\n\nTranscript (${msgs.length} messages):`;
    for (const m of msgs.slice(0, 20)) {
      r += `\n${m.speaker}: ${(m.content || '').slice(0, 200)}`;
    }
    if (msgs.length > 20) r += `\n... (${msgs.length - 20} more)`;
  }
  return r;
}

// ============================================================
// WORK UNIT EXTRAS (4 tools)
// ============================================================

async function toolGetWorkUnitDetail(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({
    where: { id: args.workUnitId, companyId },
    include: {
      escrow: true,
      executions: { include: { student: { select: { name: true } } }, orderBy: { assignedAt: 'desc' }, take: 5 },
      milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
    },
  });
  if (!wu) return 'Work unit not found.';
  let r = `"${wu.title}" [${wu.id.slice(0, 8)}]\nStatus: ${wu.status} | $${(wu.priceInCents / 100).toFixed(2)} | ${wu.deadlineHours}h | ${wu.minTier} tier | complexity ${wu.complexityScore}/5`;
  r += `\nCategory: ${wu.category} | Assignment: ${wu.assignmentMode} | Revisions: ${wu.revisionLimit}`;
  r += `\nSkills: ${wu.requiredSkills.join(', ') || 'none'} | Format: ${wu.deliverableFormat.join(', ') || 'any'}`;
  if (wu.escrow) r += `\nEscrow: ${wu.escrow.status} ($${(wu.escrow.amountInCents / 100).toFixed(2)})`;
  if (wu.executions.length) r += `\nExecutions: ${wu.executions.map(e => `${e.student.name} — ${e.status}`).join(', ')}`;
  if (wu.milestoneTemplates.length) r += `\nMilestones: ${wu.milestoneTemplates.map(m => m.description).join(', ')}`;
  r += `\nSpec: ${wu.spec.slice(0, 300)}${wu.spec.length > 300 ? '...' : ''}`;
  return r;
}

async function toolGetImprovements(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({ where: { id: args.workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';
  try {
    const { analyzeTaskForImprovements } = await import('./task-improvements.js');
    const result = await analyzeTaskForImprovements(wu.id);
    if (!result.suggestions?.length) return `"${wu.title}" has no improvement suggestions. Overall health: ${result.overallHealth}.`;
    return `"${wu.title}" — ${result.overallHealth}\n${result.suggestions.map((s: any) => `[${s.priority}] ${s.title}: ${s.description}`).join('\n')}`;
  } catch { return 'Improvement analysis not available.'; }
}

async function toolGetWorkUnitSessions(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({ where: { id: args.workUnitId, companyId } });
  if (!wu || !wu.infoCollectionTemplateId) return 'No interview attached to this work unit.';
  const sessions = await db.interviewSession.findMany({
    where: { templateId: wu.infoCollectionTemplateId },
    include: { template: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (sessions.length === 0) return 'No sessions yet.';
  return sessions.map(s => `${s.template.name} — ${s.status}, ${new Date(s.createdAt).toLocaleDateString()}`).join('\n');
}

async function toolGetQAResults(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findUnique({ where: { id: args.executionId }, include: { workUnit: true } });
  if (!exec || exec.workUnit.companyId !== companyId) return 'Execution not found.';
  if (!(exec as any).qaResults) return 'No QA results available yet.';
  return `QA results for execution ${args.executionId.slice(0, 8)}: ${JSON.stringify((exec as any).qaResults).slice(0, 500)}`;
}

// ============================================================
// EXECUTION TRACKING (5 tools)
// ============================================================

async function toolListReviewQueue(companyId: string): Promise<string> {
  const execs = await db.execution.findMany({
    where: { workUnit: { companyId }, status: 'submitted' },
    include: { workUnit: { select: { title: true } }, student: { select: { name: true } } },
    orderBy: { submittedAt: 'desc' },
    take: 20,
  });
  if (execs.length === 0) return 'No submissions awaiting review.';
  return execs.map(e => `"${e.workUnit.title}" by ${e.student.name} — submitted ${e.submittedAt ? new Date(e.submittedAt).toLocaleDateString() : 'recently'} [${e.id.slice(0, 8)}]`).join('\n');
}

async function toolGetRevisions(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findUnique({ where: { id: args.executionId }, include: { workUnit: true } });
  if (!exec || exec.workUnit.companyId !== companyId) return 'Execution not found.';
  const revisions = await db.revisionRequest.findMany({
    where: { executionId: args.executionId },
    orderBy: { revisionNumber: 'desc' },
  });
  if (revisions.length === 0) return 'No revisions.';
  return revisions.map(r => `Revision ${r.revisionNumber}: ${r.overallFeedback.slice(0, 100)}`).join('\n');
}

async function toolCancelExecution(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findUnique({ where: { id: args.executionId }, include: { workUnit: true } });
  if (!exec || exec.workUnit.companyId !== companyId) return 'Execution not found.';
  if (['approved', 'cancelled'].includes(exec.status)) return `Cannot cancel — status is ${exec.status}.`;
  await db.execution.update({ where: { id: args.executionId }, data: { status: 'cancelled' } });
  await db.workUnit.update({ where: { id: exec.workUnitId }, data: { status: 'active' } });
  return `Cancelled execution. Work unit set back to active.`;
}

async function toolGetNotifications(args: any, companyId: string): Promise<string> {
  const company = await db.companyProfile.findUnique({ where: { id: companyId }, include: { user: true } });
  if (!company) return 'Company not found.';
  const notifs = await db.notification.findMany({
    where: { userId: company.user.clerkId, userType: 'company' },
    orderBy: { createdAt: 'desc' },
    take: args.limit || 10,
  });
  if (notifs.length === 0) return 'No notifications.';
  return notifs.map(n => `${n.title}: ${n.body} (${new Date(n.createdAt).toLocaleDateString()})`).join('\n');
}

async function toolGetAnalytics(companyId: string): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [total, completed, active, spend] = await Promise.all([
    db.workUnit.count({ where: { companyId } }),
    db.execution.count({ where: { workUnit: { companyId }, status: 'approved' } }),
    db.execution.count({ where: { workUnit: { companyId }, status: { in: ['assigned', 'clocked_in', 'submitted'] } } }),
    db.escrow.aggregate({ where: { companyId, status: { in: ['funded', 'released'] } }, _sum: { amountInCents: true } }),
  ]);
  return `Total work units: ${total}\nCompleted executions: ${completed}\nActive executions: ${active}\nTotal escrow spend: $${((spend._sum.amountInCents || 0) / 100).toFixed(2)}`;
}

// ============================================================
// FINANCIAL (7 tools)
// ============================================================

async function toolListInvoices(companyId: string): Promise<string> {
  const invoices = await db.invoice.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 10 });
  if (invoices.length === 0) return 'No invoices.';
  return invoices.map(i => `Invoice ${i.id.slice(0, 8)} — $${(i.totalInCents / 100).toFixed(2)}, ${i.status}, ${new Date(i.createdAt).toLocaleDateString()}`).join('\n');
}

async function toolPayInvoice(args: any, companyId: string): Promise<string> {
  const invoice = await db.invoice.findFirst({ where: { id: args.invoiceId, companyId } });
  if (!invoice) return 'Invoice not found.';
  if (invoice.status === 'paid') return 'Invoice already paid.';
  await db.invoice.update({ where: { id: args.invoiceId }, data: { status: 'paid', paidAt: new Date() } });
  return `Paid invoice $${(invoice.totalInCents / 100).toFixed(2)}.`;
}

async function toolSetBudgetPeriod(args: any, companyId: string): Promise<string> {
  const existing = await db.budgetPeriod.findFirst({ where: { companyId, month: args.month, year: args.year } });
  if (existing) {
    await db.budgetPeriod.update({ where: { id: existing.id }, data: { budgetCapInCents: args.budgetCapInCents } });
    return `Updated budget for ${args.month}/${args.year} to $${(args.budgetCapInCents / 100).toFixed(2)}.`;
  }
  await db.budgetPeriod.create({ data: { companyId, month: args.month, year: args.year, budgetCapInCents: args.budgetCapInCents } });
  return `Set budget for ${args.month}/${args.year}: $${(args.budgetCapInCents / 100).toFixed(2)}.`;
}

async function toolGetTransactions(args: any, companyId: string): Promise<string> {
  const txns = await db.paymentTransaction.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: args.limit || 10,
  });
  if (txns.length === 0) return 'No transactions.';
  return txns.map(t => `$${(t.amountInCents / 100).toFixed(2)} ${t.direction} — ${t.type}, ${t.status}, ${new Date(t.createdAt).toLocaleDateString()}`).join('\n');
}

async function toolAddFunds(args: any, companyId: string): Promise<string> {
  return `To add $${(args.amountInCents / 100).toFixed(2)}, please use the billing setup in Settings. Stripe payment links cannot be generated via chat for security.`;
}

async function toolUpdateBilling(args: any, companyId: string): Promise<string> {
  const data: any = {};
  if (args.billingMethod) data.billingMethod = args.billingMethod;
  if (args.monthlyBudgetCap !== undefined) data.monthlyBudgetCap = args.monthlyBudgetCap;
  await db.companyProfile.update({ where: { id: companyId }, data });
  return `Billing updated. ${args.billingMethod ? `Method: ${args.billingMethod}` : ''} ${args.monthlyBudgetCap ? `Budget cap: $${(args.monthlyBudgetCap / 100).toFixed(2)}` : ''}`.trim();
}

async function toolGenerateContract(companyId: string): Promise<string> {
  return 'Contract generation requires DocuSign integration. Please complete this in Settings > Company Profile.';
}

// ============================================================
// COMPANY MANAGEMENT (4 tools)
// ============================================================

async function toolGetCompanyProfile(companyId: string): Promise<string> {
  const c = await db.companyProfile.findUnique({ where: { id: companyId } });
  if (!c) return 'Company profile not found.';
  return `${c.companyName}${c.legalName ? ` (${c.legalName})` : ''}\nWebsite: ${c.website || 'not set'}\nVerification: ${c.verificationStatus}\nBilling: ${c.billingMethod || 'not configured'}\nContract: ${c.contractStatus}`;
}

async function toolUpdateCompanyProfile(args: any, companyId: string): Promise<string> {
  const data: any = {};
  if (args.companyName) data.companyName = args.companyName;
  if (args.legalName) data.legalName = args.legalName;
  if (args.website) data.website = args.website;
  await db.companyProfile.update({ where: { id: companyId }, data });
  return `Updated company profile. ${Object.keys(data).join(', ')} changed.`;
}

async function toolListDisputes(companyId: string): Promise<string> {
  const disputes = await db.dispute.findMany({
    where: { companyId },
    include: { student: { select: { name: true } } },
    orderBy: { filedAt: 'desc' },
    take: 10,
  });
  if (disputes.length === 0) return 'No disputes.';
  return disputes.map(d => `${d.status} — filed by ${d.filedBy}, ${d.student.name}: ${d.reason.slice(0, 80)} [${d.id.slice(0, 8)}]`).join('\n');
}

async function toolFileDispute(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findUnique({ where: { id: args.executionId }, include: { workUnit: true } });
  if (!exec || exec.workUnit.companyId !== companyId) return 'Execution not found.';
  const dispute = await db.dispute.create({
    data: { executionId: args.executionId, studentId: exec.studentId, companyId, filedBy: 'company', reason: args.reason, status: 'filed' },
  });
  return `Filed dispute for execution ${args.executionId.slice(0, 8)}. Dispute ID: ${dispute.id.slice(0, 8)}.`;
}
