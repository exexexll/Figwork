/**
 * Agent Tools — functions the AI agent can call via OpenAI function calling.
 * Each wraps existing Prisma queries. No new business logic.
 */

import { db } from '@figwork/db';
import { PRICING_CONFIG, TIER_CONFIG } from '@figwork/shared';

// Helper: resolve a potentially truncated ID to full UUID
async function resolveId(table: string, shortId: string, companyId?: string): Promise<string | null> {
  if (!shortId) return null;
  // Check if it's already a valid UUID format (with or without dashes)
  const uuidPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
  if (uuidPattern.test(shortId)) return shortId;

  const prismaTable = (db as any)[table];
  if (!prismaTable) return null;

  // Check if it's a hex prefix (truncated UUID)
  const hexPattern = /^[0-9a-f]+$/i;
  if (hexPattern.test(shortId) && shortId.length >= 4) {
    try {
      const where: any = {};
      if (companyId && ['workUnit'].includes(table)) where.companyId = companyId;
      const records = await prismaTable.findMany({ where, select: { id: true }, take: 200 });
      const match = records.find((r: any) => r.id.startsWith(shortId));
      if (match) return match.id;
    } catch {}
  }

  // Fallback: name/title-based fuzzy lookup for tables that have a title/name field
  try {
    const nameField = ['workUnit'].includes(table) ? 'title'
      : ['interviewTemplate'].includes(table) ? 'name'
      : ['legalAgreement'].includes(table) ? 'title'
      : ['studentProfile'].includes(table) ? 'name'
      : null;
    if (nameField) {
      const where: any = {};
      if (companyId && table === 'workUnit') where.companyId = companyId;
      where[nameField] = { contains: shortId, mode: 'insensitive' };
      const match = await prismaTable.findFirst({ where, select: { id: true } });
      if (match) return match.id;
    }
  } catch {}

  return null;
}

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
      name: 'calculate_pricing',
      description: 'Calculate a recommended price quote for a task. Uses web search to find market rates, then computes a price factoring in complexity, deadline, tier, and platform fees. Call this when the user asks what to pay for a task or wants a pricing recommendation.',
      parameters: {
        type: 'object',
        properties: {
          taskDescription: { type: 'string', description: 'What the task involves' },
          estimatedHours: { type: 'number', description: 'Estimated hours to complete' },
          complexityScore: { type: 'number', description: '1-5 complexity rating' },
          deadlineHours: { type: 'number', description: 'Deadline in hours' },
          tier: { type: 'string', enum: ['novice', 'pro', 'elite'], description: 'Required contractor tier' },
        },
        required: ['taskDescription'],
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
  { type: 'function' as const, function: { name: 'approve_application', description: 'Approve a pending application in manual mode — moves from pending_review to assigned', parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'] } } },
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
  { type: 'function' as const, function: { name: 'draft_nda', description: 'Generate a non-disclosure agreement for contractors', parameters: { type: 'object', properties: { companyName: { type: 'string' }, scope: { type: 'string', description: 'What confidential info is covered' } } } } },
  { type: 'function' as const, function: { name: 'draft_msa', description: 'Generate a master service agreement between company and Figwork', parameters: { type: 'object', properties: { companyName: { type: 'string' } } } } },
  { type: 'function' as const, function: { name: 'create_contract', description: 'Create a legal agreement that contractors must sign before starting a task. The content should be a complete, enforceable contract tailored to the specific work unit.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Contract title e.g. "UGC Content Agreement"' }, content: { type: 'string', description: 'Full contract text — must include scope, deliverables, IP, confidentiality, payment, termination' }, workUnitId: { type: 'string', description: 'Optional — attach to a specific work unit' } }, required: ['title', 'content'] } } },
  { type: 'function' as const, function: { name: 'list_contracts', description: 'List all legal agreements', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'get_contract', description: 'Get a contract with its content and signature status', parameters: { type: 'object', properties: { contractId: { type: 'string' } }, required: ['contractId'] } } },
  { type: 'function' as const, function: { name: 'update_contract', description: 'Update a contract — bumps version, optionally requires re-signing', parameters: { type: 'object', properties: { contractId: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, requiresResign: { type: 'boolean' } }, required: ['contractId'] } } },
  { type: 'function' as const, function: { name: 'activate_contract', description: 'Change a draft contract status to active. This makes it required for contractors to sign. ONLY changes status, does NOT delete anything.', parameters: { type: 'object', properties: { contractId: { type: 'string' } }, required: ['contractId'] } } },
  { type: 'function' as const, function: { name: 'delete_contract', description: 'PERMANENTLY DELETE a contract. Only use when the user explicitly asks to delete. Cannot delete active contracts.', parameters: { type: 'object', properties: { contractId: { type: 'string' } }, required: ['contractId'] } } },
  { type: 'function' as const, function: { name: 'set_onboarding', description: 'CALL THIS TOOL to set the contractor onboarding page for a work unit. Always call this — never just describe what you would create. Pass a blocks array with visual content blocks.', parameters: { type: 'object', properties: { workUnitId: { type: 'string' }, accentColor: { type: 'string', description: 'Hex color e.g. #a78bfa' }, blocks: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['hero', 'text', 'checklist', 'cta', 'image', 'video', 'file', 'divider'] }, content: { type: 'object', description: 'hero:{heading,subheading} text:{heading,body} checklist:{heading,items:[]} cta:{heading,body,buttonText} image:{url,caption} video:{url,title} file:{url,filename,description} divider:{}' } }, required: ['type', 'content'] } } }, required: ['workUnitId', 'blocks'] } } },
  { type: 'function' as const, function: { name: 'get_onboarding', description: 'Get the current onboarding page config for a work unit', parameters: { type: 'object', properties: { workUnitId: { type: 'string' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'list_all_executions', description: 'List ALL active executions across all work units — monitoring dashboard', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'get_pow_logs', description: 'Get proof-of-work check-in logs for an execution', parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'] } } },
  { type: 'function' as const, function: { name: 'request_pow_check', description: 'Request an immediate proof-of-work check-in from a contractor', parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'] } } },
  { type: 'function' as const, function: { name: 'get_monitoring_summary', description: 'Get a summary of all active work — deadlines at risk, inactive contractors, overdue tasks', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'web_search', description: 'Search the web for information — use when the user asks about market rates, competitor analysis, industry standards, legal requirements, or anything you need current data for', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } } },
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
    // Log tool calls for debugging
    console.log(`[Tool] ${toolName}(${JSON.stringify(args).slice(0, 200)})`);

    // Resolve any truncated IDs or names to full UUIDs
    if (args.workUnitId) {
      const orig = args.workUnitId;
      args.workUnitId = await resolveId('workUnit', args.workUnitId, companyId);
      if (!args.workUnitId) return `Could not find a work unit matching "${orig}". Use list_work_units to see available tasks.`;
    }
    if (args.executionId) {
      const orig = args.executionId;
      args.executionId = await resolveId('execution', args.executionId);
      if (!args.executionId) return `Could not find an execution matching "${orig}". Use list_all_executions to see available executions.`;
    }
    if (args.templateId) args.templateId = await resolveId('interviewTemplate', args.templateId, companyId);
    if (args.questionId) args.questionId = await resolveId('question', args.questionId);
    if (args.sessionId) args.sessionId = await resolveId('interviewSession', args.sessionId);
    if (args.invoiceId) args.invoiceId = await resolveId('invoice', args.invoiceId);
    if (args.contractId) args.contractId = await resolveId('legalAgreement', args.contractId, companyId);
    if (args.studentId) args.studentId = await resolveId('studentProfile', args.studentId);
    switch (toolName) {
      case 'create_work_unit':
        return await toolCreateWorkUnit(args, companyId);
      case 'update_work_unit':
        return await toolUpdateWorkUnit(args, companyId);
      case 'estimate_cost':
        return await toolEstimateCost(args);
      case 'calculate_pricing':
        return await toolCalculatePricing(args);
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
      case 'approve_application': return await toolApproveApplication(args, companyId);
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
      case 'draft_nda': return await toolDraftNDA(args, companyId);
      case 'draft_msa': return await toolDraftMSA(args, companyId);
      case 'create_contract': return await toolCreateContract(args, companyId);
      case 'list_contracts': return await toolListContracts();
      case 'get_contract': return await toolGetContract(args);
      case 'update_contract': return await toolUpdateContract(args);
      case 'activate_contract': return await toolActivateContract(args);
      case 'delete_contract': return await toolDeleteContract(args);
      case 'set_onboarding': return await toolSetOnboarding(args, companyId);
      case 'get_onboarding': return await toolGetOnboarding(args, companyId);
      case 'list_all_executions': return await toolListAllExecutions(companyId);
      case 'get_pow_logs': return await toolGetPOWLogs(args, companyId);
      case 'request_pow_check': return await toolRequestPOWCheck(args, companyId);
      case 'get_monitoring_summary': return await toolGetMonitoringSummary(companyId);
      case 'web_search': return await toolWebSearch(args);
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

async function toolCalculatePricing(args: any): Promise<string> {
  const { taskDescription, estimatedHours, complexityScore, deadlineHours, tier } = args;
  if (!taskDescription) return 'Task description is required.';

  // Step 1: Web search for market rates
  let marketData = '';
  try {
    const searchQuery = `freelance hourly rate ${taskDescription} 2024 2025`;
    marketData = await toolWebSearch({ query: searchQuery });
  } catch { marketData = 'Market data unavailable.'; }

  // Step 2: Calculate base rate using internal logic
  const hours = estimatedHours || 4;
  const complexity = complexityScore || 3;
  const deadline = deadlineHours || 48;
  const selectedTier = tier || 'novice';

  // Base hourly rates by tier
  const tierRates: Record<string, number> = { novice: 1500, pro: 3000, elite: 6000 }; // cents
  const baseHourly = tierRates[selectedTier] || 1500;

  // Complexity multiplier: 1x at complexity 1, up to 2x at complexity 5
  const complexityMultiplier = 1 + (complexity - 1) * 0.25;

  // Urgency premium: tasks with <24h deadline get 1.5x, <12h get 2x
  let urgencyMultiplier = 1;
  if (deadline < 12) urgencyMultiplier = 2.0;
  else if (deadline < 24) urgencyMultiplier = 1.5;
  else if (deadline < 48) urgencyMultiplier = 1.2;

  const subtotalCents = Math.round(baseHourly * hours * complexityMultiplier * urgencyMultiplier);
  const feePercent = PRICING_CONFIG.platformFees[selectedTier as keyof typeof PRICING_CONFIG.platformFees] || 0.15;
  const feeCents = Math.round(subtotalCents * feePercent);
  const totalCents = subtotalCents + feeCents;

  const lowRange = Math.round(subtotalCents * 0.8);
  const highRange = Math.round(subtotalCents * 1.3);

  return `PRICING ANALYSIS for: ${taskDescription}

MARKET RESEARCH:
${marketData.slice(0, 800)}

CALCULATION:
- Tier: ${selectedTier} (base $${(baseHourly / 100).toFixed(0)}/hr)
- Estimated hours: ${hours}h
- Complexity: ${complexity}/5 (${complexityMultiplier}x)
- Urgency: ${deadline}h deadline (${urgencyMultiplier}x)
- Subtotal: $${(subtotalCents / 100).toFixed(2)}
- Platform fee (${(feePercent * 100).toFixed(0)}%): $${(feeCents / 100).toFixed(2)}
- Total cost to you: $${(totalCents / 100).toFixed(2)}
- Contractor receives: $${(subtotalCents / 100).toFixed(2)}

RECOMMENDED RANGE: $${(lowRange / 100).toFixed(0)} – $${(highRange / 100).toFixed(0)}
SUGGESTED PRICE: $${(subtotalCents / 100).toFixed(0)}`;
}

async function toolDraftSOW(args: any): Promise<string> {
  const { projectName, scope, deliverables, timeline, budget } = args;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  let doc = `STATEMENT OF WORK

Effective Date: ${date}
Project: ${projectName}

1. SCOPE OF WORK
${scope}

2. DELIVERABLES
${deliverables?.length ? deliverables.map((d: string, i: number) => `   ${i + 1}. ${d}`).join('\n') : '   As described in the scope above.'}

3. TIMELINE
${timeline || 'Per individual task deadlines set at assignment.'}

4. COMPENSATION
${budget || 'Per task pricing as listed on the Figwork platform.'} All payments are escrow-protected and released only upon approval of deliverables.

5. INTELLECTUAL PROPERTY
All work product, including but not limited to designs, code, copy, and data, shall become the exclusive property of the Client upon final payment. The Contractor retains no rights to the deliverables.

6. CONFIDENTIALITY
The Contractor agrees to hold in confidence all proprietary information disclosed during the engagement and shall not share, publish, or use such information for any purpose other than completing the assigned work.

7. PAYMENT TERMS
Payment is held in escrow by Figwork and released within 48 hours of deliverable approval. Platform fees are deducted before payout. Instant payout is available for eligible contractors.

8. REVISIONS
The Client may request revisions up to the limit set per task. Additional revisions beyond the limit may be negotiated as a new task.

9. TERMINATION
Either party may terminate this SOW at any time. If terminated before completion, payment is prorated based on approved milestones. Escrow funds for incomplete work are returned to the Client.

10. DISPUTE RESOLUTION
Disputes are mediated through the Figwork platform with a 72-hour resolution SLA. If mediation fails, disputes are resolved through binding arbitration.

11. LIABILITY
Figwork acts as a marketplace facilitator and is not liable for the quality or timeliness of work beyond its QA and verification systems. Maximum liability is limited to the task payment amount.

This SOW is governed by Figwork's Master Service Agreement.`;

  return doc;
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
  const wu = await db.workUnit.findFirst({
    where: { id: args.workUnitId, companyId },
    include: { executions: { select: { studentId: true, status: true } } },
  });
  if (!wu) return 'Work unit not found.';

  // Get tier eligibility
  const tierOrder = ['novice', 'pro', 'elite'];
  const minTierIdx = tierOrder.indexOf(wu.minTier);
  const eligibleTiers = tierOrder.slice(0, minTierIdx + 1);
  // Actually: novice work can be done by all, pro by pro+elite, elite by elite only
  const canDoTiers = minTierIdx === 0 ? ['novice', 'pro', 'elite'] : minTierIdx === 1 ? ['pro', 'elite'] : ['elite'];

  // Get already assigned student IDs
  const assignedIds = wu.executions
    .filter(e => !['failed', 'cancelled'].includes(e.status))
    .map(e => e.studentId);

  const students = await db.studentProfile.findMany({
    where: {
      tier: { in: canDoTiers },
      id: { notIn: assignedIds.length > 0 ? assignedIds : ['none'] },
    },
    select: { id: true, name: true, tier: true, tasksCompleted: true, avgQualityScore: true, skillTags: true, onTimeRate: true },
    take: 15,
    orderBy: [{ avgQualityScore: 'desc' }, { tasksCompleted: 'desc' }],
  });

  if (students.length === 0) return 'No matching candidates found for this task.';

  // Score candidates by skill overlap
  const requiredSkills = (wu.requiredSkills || []).map((s: string) => s.toLowerCase());

  const scored = students.map(s => {
    const studentSkills = (s.skillTags || []).map((sk: string) => sk.toLowerCase());
    const overlap = requiredSkills.filter((rs: string) => studentSkills.some((ss: string) => ss.includes(rs) || rs.includes(ss))).length;
    const skillScore = requiredSkills.length > 0 ? overlap / requiredSkills.length : 0.5;
    const qualityScore = s.avgQualityScore;
    const expScore = Math.min(s.tasksCompleted / 10, 1);
    const total = skillScore * 0.4 + qualityScore * 0.35 + expScore * 0.15 + s.onTimeRate * 0.1;
    return { ...s, matchScore: total, skillOverlap: overlap };
  }).sort((a, b) => b.matchScore - a.matchScore);

  return scored.map(s =>
    `${s.name} — ${s.tier}, ${s.tasksCompleted} tasks, ${Math.round(s.avgQualityScore * 100)}% quality, ${Math.round(s.matchScore * 100)}% match${s.skillOverlap > 0 ? `, ${s.skillOverlap}/${requiredSkills.length} skills` : ''} [${s.id.slice(0, 8)}]`
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
  const wu = await db.workUnit.findFirst({ where: { id: args.workUnitId, companyId }, include: { escrow: true } });
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
  const wu = await db.workUnit.findFirst({
    where: { id: args.workUnitId, companyId },
    include: { executions: { where: { status: { notIn: ['failed', 'cancelled', 'approved'] } } }, escrow: true },
  });
  if (!wu) return 'Work unit not found.';

  // If active/in_progress with no active executions, auto-cancel first
  if (['active', 'paused', 'in_progress'].includes(wu.status)) {
    if (wu.executions.length > 0) {
      return `Cannot delete "${wu.title}" — it has ${wu.executions.length} active execution(s). Cancel them first.`;
    }
    await db.workUnit.update({ where: { id: wu.id }, data: { status: 'cancelled' } });
  }

  // Delete related records
  try {
    if (wu.escrow) await db.escrow.delete({ where: { id: wu.escrow.id } });
    await db.milestoneTemplate.deleteMany({ where: { workUnitId: wu.id } });
    await db.agentConversation.deleteMany({ where: { workUnitId: wu.id } });
  } catch {}

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

async function toolApproveApplication(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findFirst({
    where: { id: args.executionId, workUnit: { companyId }, status: 'pending_review' },
    include: { workUnit: true, student: true },
  });
  if (!exec) return 'Pending application not found.';
  await db.execution.update({ where: { id: args.executionId }, data: { status: 'assigned' } });
  await db.workUnit.update({ where: { id: exec.workUnitId }, data: { status: 'in_progress' } });
  return `Approved ${exec.student.name} for "${exec.workUnit.title}". They can now clock in and start working.`;
}

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

async function toolDraftNDA(args: any, companyId: string): Promise<string> {
  const company = await db.companyProfile.findUnique({ where: { id: companyId } });
  const name = args.companyName || company?.companyName || 'Company';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `NON-DISCLOSURE AGREEMENT

Effective Date: ${date}

BETWEEN: ${name} ("Disclosing Party")
AND: [Contractor Name] ("Receiving Party")

1. CONFIDENTIAL INFORMATION
${args.scope || 'All non-public information disclosed during the engagement, including but not limited to business plans, customer data, technical specifications, financial information, marketing strategies, and proprietary processes.'}

2. OBLIGATIONS
The Receiving Party agrees to:
a) Hold all Confidential Information in strict confidence
b) Not disclose to any third party without prior written consent
c) Use Confidential Information solely for the purpose of performing assigned work
d) Return or destroy all materials upon completion or termination

3. EXCLUSIONS
This agreement does not apply to information that:
a) Is publicly available through no fault of the Receiving Party
b) Was known prior to disclosure
c) Is independently developed without reference to Confidential Information
d) Is required to be disclosed by law

4. DURATION
This obligation survives for 2 years after the engagement ends.

5. REMEDIES
The Disclosing Party is entitled to injunctive relief and damages for breach.

6. GOVERNING LAW
This NDA is governed by the laws of the state where the Disclosing Party is incorporated.

SIGNATURES
${name}: _______________  Date: ___________
Contractor: _______________  Date: ___________`;
}

async function toolDraftMSA(args: any, companyId: string): Promise<string> {
  const company = await db.companyProfile.findUnique({ where: { id: companyId } });
  const name = args.companyName || company?.companyName || 'Company';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `MASTER SERVICE AGREEMENT

Effective Date: ${date}

BETWEEN: ${name} ("Client")
AND: Figwork, Inc. ("Platform")

1. SERVICES
The Platform provides a managed talent marketplace connecting the Client with independent contractors ("Contractors") for project-based work defined in individual Statements of Work ("SOWs").

2. CONTRACTOR RELATIONSHIP
Contractors are independent and not employees of either party. The Platform screens, verifies identity (KYC), and manages tax compliance (W-9/1099). The Client has no employment obligations to Contractors.

3. SCOPE OF WORK
Each task is defined as a Work Unit with specific deliverables, acceptance criteria, timeline, and price. Work Units are individually accepted through the Platform.

4. PAYMENT
a) The Client funds escrow before work begins
b) Payment is released upon Client approval of deliverables
c) Platform fee is deducted before Contractor payout
d) If work is rejected and not revised, escrow is refunded to Client

5. INTELLECTUAL PROPERTY
All deliverables and work product become the exclusive property of the Client upon final payment. Contractors assign all rights, title, and interest.

6. QUALITY ASSURANCE
The Platform provides automated QA checks, proof-of-work verification, and milestone tracking. The Client retains final approval authority.

7. CONFIDENTIALITY
Both parties agree to protect confidential information. Contractors are bound by separate NDAs.

8. LIMITATION OF LIABILITY
The Platform's total liability is limited to fees paid in the preceding 12 months. The Platform is not liable for Contractor performance beyond its screening and QA systems.

9. DISPUTE RESOLUTION
Disputes between Client and Contractor are mediated by the Platform with a 72-hour SLA. Unresolved disputes proceed to binding arbitration.

10. TERMINATION
Either party may terminate with 30 days written notice. Active work units are completed or cancelled per their terms. Escrow is settled accordingly.

11. INDEMNIFICATION
Each party indemnifies the other against claims arising from their breach of this agreement.

12. GOVERNING LAW
This agreement is governed by the laws of Delaware, USA.

SIGNATURES
${name}: _______________  Date: ___________
Figwork, Inc.: _______________  Date: ___________`;
}

// ============================================================
// CONTRACT MANAGEMENT (5 tools)
// ============================================================

async function toolCreateContract(args: any, companyId: string): Promise<string> {
  const slug = args.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) + '-' + Date.now().toString(36);

  const agreement = await db.legalAgreement.create({
    data: {
      title: args.title,
      slug,
      content: args.content,
      version: 1,
      requiresResign: true,
      status: 'draft',
    },
  });

  // If a work unit is specified, create an onboarding step linking this agreement
  if (args.workUnitId) {
    try {
      // Store the association via onboarding step
      const _db = db as any;
      await _db.onboardingStep.create({
        data: {
          stepType: 'agreement',
          label: args.title,
          description: `Sign "${args.title}" before starting work`,
          required: true,
          enabled: true,
          gateLevel: 'accept',
          orderIndex: 99,
          agreementId: agreement.id,
        },
      });
    } catch {
      // onboarding_steps table may not exist — non-fatal
    }
  }

  return `Created contract "${agreement.title}" (${agreement.id.slice(0, 8)}). Status: draft. Use activate_contract to make it live so contractors must sign it before starting work.`;
}

async function toolListContracts(): Promise<string> {
  const agreements = await db.legalAgreement.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { signatures: true } } },
  });
  if (agreements.length === 0) return 'No contracts found.';
  return agreements.map(a =>
    `${a.title} — v${a.version}, ${a.status}, ${a._count.signatures} signatures [${a.id.slice(0, 8)}]`
  ).join('\n');
}

async function toolGetContract(args: any): Promise<string> {
  const a = await db.legalAgreement.findUnique({
    where: { id: args.contractId },
    include: { _count: { select: { signatures: true } } },
  });
  if (!a) return 'Contract not found.';
  return `"${a.title}" — v${a.version}, ${a.status}, ${a._count.signatures} signatures, requires re-sign: ${a.requiresResign}\n\n${a.content.slice(0, 2000)}${a.content.length > 2000 ? '\n...(truncated)' : ''}`;
}

async function toolUpdateContract(args: any): Promise<string> {
  const a = await db.legalAgreement.findUnique({ where: { id: args.contractId } });
  if (!a) return 'Contract not found.';

  const data: any = {};
  if (args.title) data.title = args.title;
  if (args.content) data.content = args.content;
  if (args.requiresResign !== undefined) data.requiresResign = args.requiresResign;

  // Bump version if content changed
  if (args.content && args.content !== a.content) {
    data.version = a.version + 1;
  }

  await db.legalAgreement.update({ where: { id: args.contractId }, data });
  return `Updated "${a.title}" to v${data.version || a.version}.${data.version ? ' Contractors with previous signatures will need to re-sign.' : ''}`;
}

async function toolActivateContract(args: any): Promise<string> {
  if (!args.contractId) return 'Contract ID is required.';
  const a = await db.legalAgreement.findUnique({ where: { id: args.contractId } });
  if (!a) return 'Contract not found. It may have been deleted.';
  if (a.status === 'active') return `ALREADY ACTIVE: "${a.title}" is already active. No action needed. Do not call this again for this contract.`;

  await db.legalAgreement.update({ where: { id: args.contractId }, data: { status: 'active' } });
  return `DONE: Activated "${a.title}". Contractors must sign it during onboarding. Do not call activate_contract again for this contract.`;
}

async function toolDeleteContract(args: any): Promise<string> {
  if (!args.contractId) return 'Contract ID is required.';
  const a = await db.legalAgreement.findUnique({ where: { id: args.contractId } });
  if (!a) return 'Contract not found.';
  if (a.status === 'active') return `Cannot delete "${a.title}" — it's active. Archive it first.`;
  try {
    // Clean up related records
    await db.agreementSignature.deleteMany({ where: { agreementId: args.contractId } });
    try { await (db as any).onboardingStep.deleteMany({ where: { agreementId: args.contractId } }); } catch {}
    await db.legalAgreement.delete({ where: { id: args.contractId } });
    return `Deleted "${a.title}".`;
  } catch (err: any) {
    return `Failed to delete "${a.title}": ${err.message?.slice(0, 100) || 'Unknown error'}`;
  }
}

async function toolSetOnboarding(args: any, companyId: string): Promise<string> {
  const company = await db.companyProfile.findUnique({ where: { id: companyId } });
  if (!company) return 'Company not found.';

  const existing = (typeof company.address === 'object' && company.address) || {};
  const onboardingPages = (existing as any).onboardingPages || {};

  // Build block-based page data
  const blocks = (args.blocks || []).map((b: any, i: number) => ({
    id: `ai-${Date.now()}-${i}`,
    type: b.type,
    content: b.content || {},
  }));

  const prev = onboardingPages[args.workUnitId] || {};
  onboardingPages[args.workUnitId] = {
    ...prev,
    accentColor: args.accentColor || prev.accentColor || '#a78bfa',
    blocks: blocks.length > 0 ? blocks : prev.blocks || [],
  };

  await db.companyProfile.update({
    where: { id: companyId },
    data: { address: { ...existing, onboardingPages } as any },
  });

  const page = onboardingPages[args.workUnitId];
  const blockSummary = (page.blocks || []).map((b: any) => b.type).join(', ');
  return `Updated onboarding page with ${page.blocks?.length || 0} blocks (${blockSummary}). Accent: ${page.accentColor}. The panel will refresh to show changes — switch to the "onboard" tab to see it.`;
}

async function toolGetOnboarding(args: any, companyId: string): Promise<string> {
  const company = await db.companyProfile.findUnique({ where: { id: companyId } });
  if (!company) return 'Company not found.';

  const pages = ((company.address as any)?.onboardingPages || {});
  const page = pages[args.workUnitId];
  if (!page) return 'No onboarding page configured for this work unit.';

  let r = `Accent: ${page.accentColor || '#a78bfa'}\n`;
  if (page.blocks?.length) {
    r += `Blocks (${page.blocks.length}):\n`;
    page.blocks.forEach((b: any, i: number) => {
      r += `  ${i + 1}. [${b.type}]`;
      if (b.content?.heading) r += ` heading="${b.content.heading}"`;
      if (b.content?.body) r += ` body="${b.content.body.slice(0, 60)}${b.content.body.length > 60 ? '...' : ''}"`;
      if (b.content?.items?.length) r += ` items=${b.content.items.length}`;
      if (b.content?.buttonText) r += ` btn="${b.content.buttonText}"`;
      r += '\n';
    });
  }
  // Legacy fields
  if (page.welcome) r += `Legacy welcome: ${page.welcome}\n`;
  if (page.instructions) r += `Legacy instructions: ${page.instructions.slice(0, 80)}\n`;
  return r || 'Onboarding page is empty.';
}

// ============================================================
// MONITORING (4 tools)
// ============================================================

async function toolListAllExecutions(companyId: string): Promise<string> {
  const execs = await db.execution.findMany({
    where: {
      workUnit: { companyId },
      status: { in: ['assigned', 'clocked_in', 'submitted', 'revision_needed', 'pending_review', 'pending_screening'] },
    },
    include: {
      workUnit: { select: { title: true } },
      student: { select: { name: true } },
    },
    orderBy: { assignedAt: 'desc' },
    take: 30,
  });
  if (execs.length === 0) return 'No active executions.';

  return execs.map(e => {
    const deadline = e.deadlineAt ? new Date(e.deadlineAt) : null;
    const isOverdue = deadline && deadline < new Date();
    const hoursLeft = deadline ? Math.round((deadline.getTime() - Date.now()) / 3600000) : null;
    return `${e.workUnit.title} — ${e.student.name} — ${e.status}${isOverdue ? ' OVERDUE' : ''}${hoursLeft !== null ? ` (${hoursLeft}h left)` : ''} [${e.id.slice(0, 8)}]`;
  }).join('\n');
}

async function toolGetPOWLogs(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findUnique({
    where: { id: args.executionId },
    include: { workUnit: { select: { companyId: true, title: true } } },
  });
  if (!exec || exec.workUnit.companyId !== companyId) return 'Execution not found.';

  const logs = await db.proofOfWorkLog.findMany({
    where: { executionId: args.executionId },
    orderBy: { requestedAt: 'desc' },
    take: 10,
  });

  if (logs.length === 0) return `No POW logs for "${exec.workUnit.title}".`;

  return `POW logs for "${exec.workUnit.title}":\n` + logs.map(l => {
    const time = new Date(l.requestedAt).toLocaleString();
    return `${time} — ${l.status}${l.workPhotoUrl ? ' (photo submitted)' : ''}`;
  }).join('\n');
}

async function toolRequestPOWCheck(args: any, companyId: string): Promise<string> {
  const exec = await db.execution.findUnique({
    where: { id: args.executionId },
    include: { workUnit: { select: { companyId: true, title: true } }, student: { select: { name: true, id: true } } },
  });
  if (!exec || exec.workUnit.companyId !== companyId) return 'Execution not found.';
  if (exec.status !== 'clocked_in') return `Cannot request POW — contractor is ${exec.status}, not clocked in.`;

  // Create POW request
  await db.proofOfWorkLog.create({
    data: {
      executionId: args.executionId,
      studentId: exec.student.id,
      requestedAt: new Date(),
      status: 'pending',
    },
  });

  return `POW check requested for ${exec.student.name} on "${exec.workUnit.title}". They have 10 minutes to submit a photo and progress update.`;
}

async function toolGetMonitoringSummary(companyId: string): Promise<string> {
  const now = new Date();

  const [allExecs, overdueExecs, recentPOW] = await Promise.all([
    db.execution.findMany({
      where: { workUnit: { companyId }, status: { in: ['assigned', 'clocked_in', 'submitted', 'revision_needed'] } },
      include: { workUnit: { select: { title: true } }, student: { select: { name: true } } },
    }),
    db.execution.findMany({
      where: { workUnit: { companyId }, status: { in: ['assigned', 'clocked_in'] }, deadlineAt: { lt: now } },
      include: { workUnit: { select: { title: true } }, student: { select: { name: true } } },
    }),
    db.proofOfWorkLog.findMany({
      where: { execution: { workUnit: { companyId } }, status: 'failed' },
      orderBy: { requestedAt: 'desc' },
      take: 5,
      include: { execution: { include: { workUnit: { select: { title: true } }, student: { select: { name: true } } } } },
    }),
  ]);

  const clockedIn = allExecs.filter(e => e.status === 'clocked_in');
  const assigned = allExecs.filter(e => e.status === 'assigned');
  const submitted = allExecs.filter(e => e.status === 'submitted');

  let r = `Active: ${allExecs.length} executions (${clockedIn.length} working, ${assigned.length} waiting to start, ${submitted.length} awaiting review)`;

  if (overdueExecs.length > 0) {
    r += `\n\nOVERDUE (${overdueExecs.length}):`;
    for (const e of overdueExecs) {
      const hoursOver = Math.round((now.getTime() - e.deadlineAt!.getTime()) / 3600000);
      r += `\n  ${e.workUnit.title} — ${e.student.name} — ${hoursOver}h overdue`;
    }
  }

  if (recentPOW.length > 0) {
    r += `\n\nFailed POW checks:`;
    for (const p of recentPOW) {
      r += `\n  ${p.execution.workUnit.title} — ${p.execution.student.name}`;
    }
  }

  if (overdueExecs.length === 0 && recentPOW.length === 0) {
    r += '\n\nNo issues detected.';
  }

  return r;
}

async function toolWebSearch(args: any): Promise<string> {
  const query = args.query;
  if (!query) return 'No search query provided.';

  try {
    // Use Brave Search API (free tier: 2000 queries/month, no credit card)
    // Fallback to Serper if BRAVE_SEARCH_KEY not set, then to GPT knowledge
    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    const serperKey = process.env.SERPER_API_KEY;

    if (braveKey) {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
        headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': braveKey },
      });
      if (res.ok) {
        const data = await res.json() as any;
        const results = (data.web?.results || []).slice(0, 5);
        if (results.length > 0) {
          return results.map((r: any) => `${r.title}\n${r.description}\n${r.url}`).join('\n\n').slice(0, 3000);
        }
      }
    }

    if (serperKey) {
      // SerpAPI (serpapi.com)
      const res = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serperKey}&num=5`);
      if (res.ok) {
        const data = await res.json() as any;
        const organic = (data.organic_results || []).slice(0, 5);
        if (organic.length > 0) {
          return organic.map((r: any) => `${r.title}\n${r.snippet || ''}\n${r.link}`).join('\n\n').slice(0, 3000);
        }
        if (data.answer_box?.answer) return data.answer_box.answer;
        if (data.answer_box?.snippet) return data.answer_box.snippet;
      }
    }

    // No search API configured — use GPT's built-in knowledge
    return `[Web search not configured — using built-in knowledge for "${query}"]. To enable, add BRAVE_SEARCH_API_KEY or SERPER_API_KEY to .env. Answering from training data.`;
  } catch (err: any) {
    return `Search error: ${err.message || 'Failed'}. Answering from training data instead.`;
  }
}

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
