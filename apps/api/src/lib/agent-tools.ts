/**
 * Agent Tools — functions the AI agent can call via OpenAI function calling.
 * Each wraps existing Prisma queries. No new business logic.
 */

import { db } from '@figwork/db';
import { PRICING_CONFIG, TIER_CONFIG } from '@figwork/shared';
import { getOpenAIClient } from '@figwork/ai';
import { validatePublishConditions, evaluatePublishConditions, getDependentWorkUnits, type PublishConditions } from './publish-conditions.js';
import * as panelService from './company-panel-service.js';

// Helper: resolve a potentially truncated ID to full UUID
async function resolveId(table: string, shortId: string, companyId?: string): Promise<string | null> {
  if (!shortId) return null;
  // Check if it's already a valid UUID format (with or without dashes)
  const uuidPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
  if (uuidPattern.test(shortId)) return shortId;

  const prismaTable = (db as any)[table];
  if (!prismaTable) return null;

  // Check if it's a hex prefix (truncated UUID) — use SQL prefix matching (fast, no full scan)
  const hexPattern = /^[0-9a-f]+$/i;
  if (hexPattern.test(shortId) && shortId.length >= 4) {
    try {
      const where: any = { id: { startsWith: shortId } };
      if (companyId && ['workUnit', 'workflowGroup', 'workUnitTemplate'].includes(table)) where.companyId = companyId;
      const match = await prismaTable.findFirst({ where, select: { id: true } });
      if (match) return match.id;
    } catch {
      // Fallback: load and filter in JS if startsWith not supported on UUID column
      try {
        const fallbackWhere: any = {};
        if (companyId && ['workUnit', 'workflowGroup', 'workUnitTemplate'].includes(table)) fallbackWhere.companyId = companyId;
        const records = await prismaTable.findMany({ where: fallbackWhere, select: { id: true }, take: 200 });
        const found = records.find((r: any) => r.id.startsWith(shortId));
        if (found) return found.id;
      } catch {}
    }
  }

  // Fallback: name/title-based fuzzy lookup for tables that have a title/name field
  try {
    const nameField = ['workUnit'].includes(table) ? 'title'
      : ['interviewTemplate'].includes(table) ? 'name'
      : ['legalAgreement'].includes(table) ? 'title'
      : ['studentProfile'].includes(table) ? 'name'
      : ['workflowGroup'].includes(table) ? 'name'
      : ['workUnitTemplate'].includes(table) ? 'name'
      : null;
    if (nameField) {
      const where: any = {};
      if (companyId && ['workUnit', 'workflowGroup', 'workUnitTemplate'].includes(table)) where.companyId = companyId;
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
          deliverableCount: { type: 'number', description: 'How many deliverables this work unit covers (default 1)' },
          scheduledPublishAt: { type: 'string', description: 'ISO date string for scheduled publish (UTC)' },
          publishConditions: { type: 'object', description: 'Conditional publishing rules: {logic: "AND"|"OR", dependencies: [{workUnitId, condition: "published"|"completed"|"failed", onFailure?: "publish"|"cancel"|"notify", shareContext: "none"|"summary"|"full"}]}' },
        },
        required: ['title', 'spec', 'category', 'priceInCents', 'deadlineHours'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_work_unit',
      description: 'Update an existing work unit. Can change any field including minTier and complexityScore. Use this to modify contractor tier requirements (minTier: novice/pro/elite) or task complexity (complexityScore: 1-5) for existing work units.',
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
          scheduledPublishAt: { type: 'string', description: 'ISO date string for scheduled publish (UTC), or null to clear' },
          publishConditions: { type: 'object', description: 'Conditional publishing rules, or null to clear' },
          requiredSkills: { type: 'array', items: { type: 'string' } },
          deliverableFormat: { type: 'array', items: { type: 'string' } },
          acceptanceCriteria: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, required: { type: 'boolean' } } } },
          minTier: { type: 'string', enum: ['novice', 'pro', 'elite'], description: 'Minimum contractor tier required. Can be updated on existing work units to allow novice/pro/elite contractors.' },
          complexityScore: { type: 'number', description: 'Task complexity rating 1-5. Can be updated on existing work units. Lower = simpler, higher = more complex.' },
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
      description: 'List all work units with full details: status, price, deadline, category, complexity, dependencies, contractor, schedule. Use this FIRST before setting up workflows — it shows the complete picture.',
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
  { type: 'function' as const, function: { name: 'set_publish_schedule', description: 'Set scheduled publish date and/or dependency conditions for a work unit. Use to chain tasks so they auto-publish when prerequisites complete.', parameters: { type: 'object', properties: { workUnitId: { type: 'string' }, scheduledPublishAt: { type: 'string', description: 'ISO date or null to clear' }, publishConditions: { type: 'object', description: '{"logic":"AND","dependencies":[{"workUnitId":"id","condition":"completed","shareContext":"summary"}]}' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'get_publish_status', description: 'Check publish status: scheduled time, dependency conditions, which tasks depend on this one', parameters: { type: 'object', properties: { workUnitId: { type: 'string' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'setup_dependency_chain', description: 'Set up a sequential dependency chain across multiple tasks in ONE call. Each task depends on the previous one completing. Much faster than calling set_publish_schedule individually.', parameters: { type: 'object', properties: { workUnitIds: { type: 'array', items: { type: 'string' }, description: 'Ordered list of work unit IDs — task[1] depends on task[0], task[2] depends on task[1], etc.' }, condition: { type: 'string', enum: ['completed', 'published'], description: 'Default: completed' }, shareContext: { type: 'string', enum: ['none', 'summary', 'full'], description: 'Default: summary' } }, required: ['workUnitIds'] } } },
  {
    type: 'function' as const,
    function: {
      name: 'setup_parallel_dependencies',
      description: 'Set up complex parallel dependency structures with multiple dependencies per task. Use for branched workflows where tasks can have multiple prerequisites. Each dependency can have different conditions and context sharing.',
      parameters: {
        type: 'object',
        properties: {
          dependencies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                workUnitId: { type: 'string', description: 'Task that has dependencies' },
                dependsOn: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      workUnitId: { type: 'string' },
                      condition: { type: 'string', enum: ['completed', 'published', 'failed'], description: 'When dependency must be met' },
                      shareContext: { type: 'string', enum: ['none', 'summary', 'full'], description: 'How much context to share' },
                      onFailure: { type: 'string', enum: ['publish', 'cancel', 'notify'], description: 'Only if condition=failed' },
                    },
                    required: ['workUnitId'],
                  },
                  description: 'Array of dependencies for this task',
                },
              },
              required: ['workUnitId', 'dependsOn'],
            },
            description: 'Array of tasks with their dependency configurations',
          },
        },
        required: ['dependencies'],
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
  { type: 'function' as const, function: { name: 'create_contract', description: 'Create a legal agreement that contractors must sign before starting a task. Set activate=true to create AND activate in one step.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Contract title e.g. "UGC Content Agreement"' }, content: { type: 'string', description: 'Full contract text — must include scope, deliverables, IP, confidentiality, payment, termination' }, workUnitId: { type: 'string', description: 'Optional — attach to a specific work unit' }, activate: { type: 'boolean', description: 'If true, immediately activate the contract after creation (default false)' } }, required: ['title', 'content'] } } },
  { type: 'function' as const, function: { name: 'list_contracts', description: 'List all legal agreements', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'get_contract', description: 'Get a contract with its content and signature status', parameters: { type: 'object', properties: { contractId: { type: 'string' } }, required: ['contractId'] } } },
  { type: 'function' as const, function: { name: 'update_contract', description: 'Update a contract — bumps version, optionally requires re-signing', parameters: { type: 'object', properties: { contractId: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, requiresResign: { type: 'boolean' } }, required: ['contractId'] } } },
  { type: 'function' as const, function: { name: 'activate_contract', description: 'Change a draft contract status to active. This makes it required for contractors to sign. ONLY changes status, does NOT delete anything.', parameters: { type: 'object', properties: { contractId: { type: 'string' } }, required: ['contractId'] } } },
  { type: 'function' as const, function: { name: 'delete_contract', description: 'PERMANENTLY DELETE a contract. Only use when the user explicitly asks to delete. Cannot delete active contracts.', parameters: { type: 'object', properties: { contractId: { type: 'string' } }, required: ['contractId'] } } },
  { type: 'function' as const, function: { name: 'set_onboarding', description: 'Set the contractor onboarding page. TWO MODES: (1) Pass "description" with what you want and the system auto-generates blocks. (2) Pass "blocks" array manually. Mode 1 is preferred — just describe the page in plain English.', parameters: { type: 'object', properties: { workUnitId: { type: 'string' }, accentColor: { type: 'string', description: 'Hex color e.g. #a78bfa' }, description: { type: 'string', description: 'PREFERRED: Describe the onboarding page in plain English. E.g. "Welcome page for logo designers at Triple V. Include brand link https://triple3v.org, checklist for reviewing brand guidelines, and CTA to start." The system generates the blocks automatically.' }, blocks: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['hero', 'text', 'checklist', 'cta', 'image', 'video', 'file', 'divider'] }, content: { type: 'object' } }, required: ['type', 'content'] }, description: 'Manual mode: array of block objects. Only use if description mode is not sufficient.' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'get_onboarding', description: 'Get the current onboarding page config for a work unit', parameters: { type: 'object', properties: { workUnitId: { type: 'string' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'list_all_executions', description: 'List ALL active executions across all work units — monitoring dashboard', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'get_pow_logs', description: 'Get proof-of-work check-in logs for an execution', parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'] } } },
  { type: 'function' as const, function: { name: 'request_pow_check', description: 'Request an immediate proof-of-work check-in from a contractor', parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'] } } },
  { type: 'function' as const, function: { name: 'get_monitoring_summary', description: 'Get a summary of all active work — deadlines at risk, inactive contractors, overdue tasks', parameters: { type: 'object', properties: {} } } },
  // Workflow Groups — visual workflow spaces (tabs in /dashboard/workunits/workflow)
  { type: 'function' as const, function: { name: 'create_workflow_group', description: 'Create a workflow space (visual tab) to organize related tasks. ALWAYS call this when creating 2+ work units. The user sees this as a tab in the Workflow page where they can visually connect and arrange tasks.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Space name e.g. "Q1 Marketing Campaign"' }, description: { type: 'string' }, color: { type: 'string', description: 'Hex color e.g. #6366f1' }, workUnitIds: { type: 'array', items: { type: 'string' }, description: 'IDs of work units to add to this space' } }, required: ['name'] } } },
  { type: 'function' as const, function: { name: 'update_workflow_group', description: 'Rename a workflow space or change its color', parameters: { type: 'object', properties: { groupId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, color: { type: 'string' } }, required: ['groupId'] } } },
  { type: 'function' as const, function: { name: 'assign_to_workflow_group', description: 'Add or remove work units from a workflow space. Use after creating new tasks to add them to an existing project space.', parameters: { type: 'object', properties: { groupId: { type: 'string' }, addWorkUnitIds: { type: 'array', items: { type: 'string' } }, removeWorkUnitIds: { type: 'array', items: { type: 'string' } } }, required: ['groupId'] } } },
  { type: 'function' as const, function: { name: 'list_workflow_groups', description: 'List all workflow spaces and their tasks. Check before creating a new group to avoid duplicates.', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'delete_workflow_group', description: 'Delete a workflow space. Tasks are unassigned from the space but not deleted.', parameters: { type: 'object', properties: { groupId: { type: 'string' } }, required: ['groupId'] } } },
  { type: 'function' as const, function: { name: 'auto_layout_workflow', description: 'Auto-layout the workflow board for a group. Recalculates node positions based on current dependencies and saves them. Call this AFTER setting dependencies to make the visual board reflect the branched structure.', parameters: { type: 'object', properties: { groupId: { type: 'string', description: 'Workflow group ID to relayout' } }, required: ['groupId'] } } },
  // Planning
  { type: 'function' as const, function: { name: 'plan_analyze', description: 'STEP 1: Analyze a project goal. Data is stored server-side for the next steps.', parameters: { type: 'object', properties: { goal: { type: 'string' }, budget: { type: 'string' }, timeline: { type: 'string' } }, required: ['goal'] } } },
  { type: 'function' as const, function: { name: 'plan_decompose', description: 'STEP 2: Break into work units. Reads the brief from step 1 automatically — no need to pass data.', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'plan_price', description: 'STEP 3: Price each work unit. Reads work units from step 2 automatically.', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'plan_legal', description: 'STEP 4: Generate contracts + onboarding. Reads everything from previous steps automatically.', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'plan_execute', description: 'STEP 5: Execute the plan — creates all work units, contracts, and onboarding pages in the system. Call after the user approves the plan.', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'web_search', description: 'Search the web for information — use when the user asks about market rates, competitor analysis, industry standards, legal requirements, or anything you need current data for', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } } },
  { type: 'function' as const, function: { name: 'get_company_profile', description: 'View company profile details', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'update_company_profile', description: 'Edit company name, website, address', parameters: { type: 'object', properties: { companyName: { type: 'string' }, legalName: { type: 'string' }, website: { type: 'string' } } } } },
  { type: 'function' as const, function: { name: 'list_disputes', description: 'List disputes', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'file_dispute', description: 'File a dispute against an execution', parameters: { type: 'object', properties: { executionId: { type: 'string' }, reason: { type: 'string' } }, required: ['executionId', 'reason'] } } },
  // --- Company Panel Tools ---
  { type: 'function' as const, function: { name: 'mark_notification_read', description: 'Mark a single notification as read', parameters: { type: 'object', properties: { notificationId: { type: 'string' } }, required: ['notificationId'] } } },
  { type: 'function' as const, function: { name: 'mark_all_notifications_read', description: 'Mark all notifications as read', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'export_work_units', description: 'Export all work units with escrow and executions as JSON. Returns summary + data in tool result.', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'export_executions', description: 'Export all executions as JSON. Returns summary + data in tool result.', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'bulk_update_work_units', description: 'Update multiple work units at once (status, deadline, price, etc.)', parameters: { type: 'object', properties: { workUnitIds: { type: 'array', items: { type: 'string' } }, status: { type: 'string' }, deadlineHours: { type: 'number' }, priceInCents: { type: 'number' } }, required: ['workUnitIds'] } } },
  { type: 'function' as const, function: { name: 'bulk_publish_work_units', description: 'Publish multiple draft work units at once', parameters: { type: 'object', properties: { workUnitIds: { type: 'array', items: { type: 'string' } } }, required: ['workUnitIds'] } } },
  { type: 'function' as const, function: { name: 'bulk_assign_contractor', description: 'Assign the same contractor to multiple work units', parameters: { type: 'object', properties: { workUnitIds: { type: 'array', items: { type: 'string' } }, studentId: { type: 'string' } }, required: ['workUnitIds', 'studentId'] } } },
  { type: 'function' as const, function: { name: 'archive_work_unit', description: 'Archive a work unit (soft delete, recoverable)', parameters: { type: 'object', properties: { workUnitId: { type: 'string' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'restore_work_unit', description: 'Restore an archived work unit', parameters: { type: 'object', properties: { workUnitId: { type: 'string' } }, required: ['workUnitId'] } } },
  { type: 'function' as const, function: { name: 'list_archived_work_units', description: 'List all archived work units', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'save_work_unit_template', description: 'Save a work unit as a reusable template', parameters: { type: 'object', properties: { name: { type: 'string' }, workUnitId: { type: 'string' } }, required: ['name', 'workUnitId'] } } },
  { type: 'function' as const, function: { name: 'list_work_unit_templates', description: 'List all saved work unit templates', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'create_work_unit_from_template', description: 'Create a draft work unit from a saved template', parameters: { type: 'object', properties: { templateId: { type: 'string' }, title: { type: 'string' } }, required: ['templateId'] } } },
  { type: 'function' as const, function: { name: 'set_contractor_preference', description: 'Set contractor preference (blacklist or whitelist)', parameters: { type: 'object', properties: { studentId: { type: 'string' }, type: { type: 'string', enum: ['blacklist', 'whitelist'] }, reason: { type: 'string' } }, required: ['studentId', 'type'] } } },
  { type: 'function' as const, function: { name: 'list_contractor_preferences', description: 'List all contractor preferences (blacklist/whitelist)', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'get_contractor_history', description: 'Get all past work with a specific contractor', parameters: { type: 'object', properties: { studentId: { type: 'string' } }, required: ['studentId'] } } },
  { type: 'function' as const, function: { name: 'get_activity_log', description: 'Get company activity log (audit trail)', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  // --- Execution Messaging ---
  { type: 'function' as const, function: { name: 'send_message_to_contractor', description: 'Send a message to the contractor working on a task. Use when the user wants to communicate with a contractor about requirements, feedback, or clarifications.', parameters: { type: 'object', properties: { executionId: { type: 'string', description: 'Execution ID (use list_all_executions to find)' }, content: { type: 'string', description: 'Message text to send' } }, required: ['executionId', 'content'] } } },
  { type: 'function' as const, function: { name: 'get_execution_messages', description: 'Get the message thread between client and contractor for an execution', parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'] } } },
];

// ============================================================
// DYNAMIC TOOL SELECTION — reduces input tokens by 40-60%
// Only sends relevant tools based on user message intent.
// ============================================================

const TOOL_GROUPS: Record<string, string[]> = {
  core: [
    'list_work_units', 'get_work_unit_detail', 'update_work_unit', 'web_search',
    'get_company_profile', 'get_analytics', 'get_notifications',
    'list_workflow_groups', 'list_candidates', 'assign_student',
    'list_all_executions', 'get_monitoring_summary',
  ],
  scope: [
    'create_work_unit', 'update_work_unit', 'estimate_cost', 'calculate_pricing',
    'add_milestones', 'publish_work_unit', 'delete_work_unit',
    'create_interview', 'list_interviews', 'get_interview_detail',
    'update_interview', 'delete_interview', 'add_question', 'update_question',
    'delete_question', 'generate_link', 'list_knowledge', 'get_sessions',
    'get_session_detail', 'get_work_unit_sessions', 'get_improvements', 'get_qa_results',
    'create_contract', 'activate_contract', 'set_onboarding', 'get_onboarding',
  ],
  operations: [
    'get_monitoring_summary', 'list_all_executions', 'get_execution_status',
    'review_submission', 'approve_application', 'list_review_queue',
    'get_revisions', 'cancel_execution', 'request_pow_check', 'get_pow_logs',
    'list_candidates', 'assign_student', 'update_work_unit',
    'send_message_to_contractor', 'get_execution_messages',
  ],
  contracts: [
    'create_contract', 'list_contracts', 'get_contract', 'update_contract',
    'activate_contract', 'delete_contract', 'draft_sow', 'draft_nda', 'draft_msa',
    'list_work_units',
  ],
  onboarding: [
    'set_onboarding', 'get_onboarding',
  ],
  financial: [
    'get_billing', 'list_invoices', 'pay_invoice', 'set_budget_period',
    'get_transactions', 'add_funds', 'update_billing', 'generate_contract',
    'estimate_cost',
  ],
  workflow: [
    'create_workflow_group', 'update_workflow_group', 'assign_to_workflow_group',
    'delete_workflow_group', 'setup_dependency_chain', 'setup_parallel_dependencies',
    'set_publish_schedule', 'get_publish_status', 'list_work_units', 'list_workflow_groups',
    'auto_layout_workflow',
  ],
  planning: [
    'plan_analyze', 'plan_decompose', 'plan_price', 'plan_legal', 'plan_execute',
    'list_work_units', 'create_work_unit', 'update_work_unit',
    'setup_dependency_chain', 'setup_parallel_dependencies',
    'create_workflow_group', 'list_workflow_groups',
  ],
  panel: [
    'mark_notification_read', 'mark_all_notifications_read',
    'export_work_units', 'export_executions',
    'bulk_update_work_units', 'bulk_publish_work_units', 'bulk_assign_contractor',
    'archive_work_unit', 'restore_work_unit', 'list_archived_work_units',
    'save_work_unit_template', 'list_work_unit_templates', 'create_work_unit_from_template',
    'set_contractor_preference', 'list_contractor_preferences',
    'get_contractor_history', 'get_activity_log',
  ],
  company: [
    'update_company_profile', 'list_disputes', 'file_dispute',
  ],
};

// All valid group names for validation
const VALID_GROUPS = new Set(Object.keys(TOOL_GROUPS));

// Intent classification prompt — kept minimal for speed + low token usage
const INTENT_SYSTEM_PROMPT = `Classify the user's intent into tool groups. Return {"groups":["group1","group2"]}.

Groups:
- scope: create/edit/delete/VIEW tasks, check specs, check deliverables, check requirements, check acceptance criteria, interviews, milestones, publishing, screening, contracts for tasks, onboarding pages for tasks
- operations: monitor executions, review submissions, POW checks, assign contractors, check execution status, candidate matching
- contracts: create/edit legal agreements ONLY (NDAs, SOWs, MSAs), activate contracts — NOT "check requirements"
- onboarding: set/get contractor onboarding pages ONLY when user explicitly says "onboarding page" or "onboarding experience" — NOT for checking task specs/requirements
- financial: billing, invoices, budgets, pricing, escrow, transactions, payments, costs
- workflow: dependency chains, workflow groups/spaces, scheduling, task ordering, publish conditions, layout
- planning: "plan a project", "break this down", multi-step project setup (analyze→decompose→price→legal→execute)
- panel: bulk operations, export data, archive/restore, templates, contractor blacklist/whitelist, activity log, mark notifications
- company: company profile edits, disputes

Rules:
- Return 1-5 groups. When in doubt, include MORE groups rather than fewer.
- "yes"/"do it"/"confirm"/"go ahead" → return groups from the Recent context below.
- "check"/"view"/"show"/"what are" + deliverables/requirements/spec/criteria → ["scope"] NOT onboarding
- If the user mentions BOTH tasks AND dependencies → ["scope","workflow"]
- If the user mentions creating tasks as part of a project → ["scope","workflow","planning"]
- If truly ambiguous with no context → return ALL groups.`;

/**
 * Classify user intent into tool groups.
 * Uses gpt-4o-mini (cheap, fast) instead of gpt-5.2 to save cost.
 * Returns the group names as a string array.
 */
async function classifyIntent(
  message: string,
  recentHistory?: Array<{ role: string; content?: string | null; toolCalls?: any }>,
): Promise<string[]> {
  const openai = getOpenAIClient();

  // Build a tiny context window — just last 2 messages for continuation detection
  let contextSnippet = '';
  if (recentHistory?.length) {
    const tail = recentHistory.slice(-2);
    const parts: string[] = [];
    for (const msg of tail) {
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (!text) continue;
      const role = msg.role === 'user' ? 'U' : 'A';
      parts.push(`${role}: ${text.slice(0, 150)}`);
      // Include tool names from previous turn
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        const names = (msg.toolCalls as any[]).map(tc => tc.function?.name).filter(Boolean).join(',');
        if (names) parts.push(`[tools used: ${names}]`);
      }
    }
    if (parts.length) contextSnippet = `\nRecent:\n${parts.join('\n')}`;
  }

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Cheap + fast for classification (50x cheaper than gpt-5.2)
      messages: [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: `${message}${contextSnippet}` },
      ],
      max_completion_tokens: 60,
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const raw = res.choices[0]?.message?.content || '[]';
    // Parse — handle both {"groups":[...]} and bare [...]
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return []; }
    const arr: string[] = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed.groups) ? parsed.groups
      : Array.isArray(parsed.intent) ? parsed.intent
      : [];
    // Validate group names
    return arr.filter(g => VALID_GROUPS.has(g));
  } catch (err: any) {
    console.error('[Intent] Classification failed:', err?.message?.slice(0, 80));
    return []; // empty → fallback below will add defaults
  }
}

/**
 * Select relevant tools based on user message + recent conversation history.
 * Uses gpt-5.2 for intent classification (~60 output tokens).
 * Always includes 'core'. Falls back to scope+operations+financial on failure.
 */
export async function selectToolsForMessage(
  message: string,
  recentHistory?: Array<{ role: string; content?: string | null; toolCalls?: any }>,
): Promise<typeof TOOL_DEFINITIONS> {
  const groups = new Set<string>(['core']);

  // GPT-5.2 intent classification
  const classified = await classifyIntent(message, recentHistory);
  for (const g of classified) groups.add(g);

  // Also include groups from tools used in the last few turns (keeps continuity)
  if (recentHistory?.length) {
    for (const msg of recentHistory.slice(-3)) {
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls as any[]) {
          const toolName = tc.function?.name || '';
          for (const [groupName, toolNames] of Object.entries(TOOL_GROUPS)) {
            if (toolNames.includes(toolName)) groups.add(groupName);
          }
        }
      }
    }
  }

  // If classification returned nothing or only core, include ALL groups for maximum accuracy
  // Better to send too many tools than miss the one the user needs
  if (groups.size <= 1) {
    for (const g of Object.keys(TOOL_GROUPS)) groups.add(g);
  }

  // Collect all tool names from matched groups
  const allowedNames = new Set<string>();
  for (const group of groups) {
    const tools = TOOL_GROUPS[group];
    if (tools) {
      for (const name of tools) allowedNames.add(name);
    }
  }

  return TOOL_DEFINITIONS.filter(t => allowedNames.has(t.function.name));
}

// ============================================================
// DIRECT READ COMMANDS — skip AI entirely for simple reads
// ============================================================

export const DIRECT_READ_COMMANDS: Array<{
  patterns: RegExp[];
  toolName: string;
  args: (msg: string) => Record<string, any>;
  format: (result: string) => string;
}> = [
  {
    patterns: [
      /^(list|show|my)\s*(all\s+)?(tasks?|work\s*units?)\s*$/i,
      /^what\s*(are\s+)?my\s*(tasks?|work\s*units?)\s*\??$/i,
    ],
    toolName: 'list_work_units',
    args: () => ({}),
    format: (r) => r === 'No work units found.'
      ? "You don't have any work units yet. Would you like to create one?"
      : `Here are your current work units:\n\n${r}`,
  },
  {
    patterns: [
      /^(show|check|get)\s*(my\s+)?billing\s*$/i,
      /^billing\s*(status|summary)?\s*$/i,
    ],
    toolName: 'get_billing',
    args: () => ({}),
    format: (r) => `**Billing Summary**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|check|get)\s*(my\s+)?review\s*queue\s*$/i,
      /^(what'?s?\s+)?(pending|awaiting)\s+review\s*\??$/i,
    ],
    toolName: 'list_review_queue',
    args: () => ({}),
    format: (r) => r === 'No submissions awaiting review.'
      ? 'No submissions are currently awaiting your review.'
      : `**Review Queue**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|check|get)\s*(my\s+)?analytics\s*$/i,
      /^(how\s+am\s+i\s+doing|dashboard|stats)\s*\??$/i,
    ],
    toolName: 'get_analytics',
    args: () => ({}),
    format: (r) => `**Analytics**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|list|get)\s*(my\s+)?(all\s+)?executions?\s*$/i,
      /^(who'?s?\s+)?working\s+(on\s+what|right\s+now)\s*\??$/i,
    ],
    toolName: 'list_all_executions',
    args: () => ({}),
    format: (r) => r === 'No active executions.'
      ? 'No active executions right now.'
      : `**Active Executions**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|check|get)\s*(my\s+)?monitoring\s*(summary)?\s*$/i,
      /^(any\s+)?(issues?|problems?|alerts?)\s*\??\s*$/i,
    ],
    toolName: 'get_monitoring_summary',
    args: () => ({}),
    format: (r) => `**Monitoring Summary**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|list|get)\s*(my\s+)?(all\s+)?contracts?\s*$/i,
    ],
    toolName: 'list_contracts',
    args: () => ({}),
    format: (r) => r === 'No contracts found.'
      ? 'No contracts found. Would you like to create one?'
      : `**Contracts**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|list|get)\s*(my\s+)?(all\s+)?invoices?\s*$/i,
    ],
    toolName: 'list_invoices',
    args: () => ({}),
    format: (r) => r === 'No invoices.'
      ? 'No invoices found.'
      : `**Invoices**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|list|get)\s*(my\s+)?(all\s+)?workflow\s*(groups?|spaces?)?\s*$/i,
    ],
    toolName: 'list_workflow_groups',
    args: () => ({}),
    format: (r) => `**Workflow Spaces**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|list|get)\s*(my\s+)?(all\s+)?notifications?\s*$/i,
      /^what'?s?\s+new\s*\??$/i,
    ],
    toolName: 'get_notifications',
    args: () => ({}),
    format: (r) => r === 'No notifications.'
      ? 'No new notifications.'
      : `**Notifications**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|list|get)\s*(my\s+)?(all\s+)?(interview\s*)?templates?\s*$/i,
      /^(show|list)\s*(my\s+)?interviews?\s*$/i,
    ],
    toolName: 'list_interviews',
    args: () => ({}),
    format: (r) => r === 'No interview templates.'
      ? 'No interview templates yet. Would you like to create one?'
      : `**Interview Templates**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|list|get)\s*(my\s+)?(all\s+)?archived\s*(tasks?|work\s*units?)?\s*$/i,
    ],
    toolName: 'list_archived_work_units',
    args: () => ({}),
    format: (r) => r === 'No archived work units.'
      ? 'No archived work units.'
      : `**Archived Work Units**\n\n${r}`,
  },
  {
    patterns: [
      /^(show|list|get)\s*(my\s+)?(all\s+)?(saved\s+)?templates?\s*$/i,
    ],
    toolName: 'list_work_unit_templates',
    args: () => ({}),
    format: (r) => r === 'No templates saved.'
      ? 'No saved templates yet.'
      : `**Saved Templates**\n\n${r}`,
  },
];

// Stream writer type for emitting thinking text during planning
export type StreamWriter = (text: string) => void;
export type ProgressWriter = (data: { stage: string; detail: string; current: number; total: number }) => void;
let _streamWriter: StreamWriter | null = null;
let _progressWriter: ProgressWriter | null = null;
export function setStreamWriter(writer: StreamWriter | null) { _streamWriter = writer; }
export function setProgressWriter(writer: ProgressWriter | null) { _progressWriter = writer; }
function emitThinking(text: string) { if (_streamWriter) _streamWriter(text); }
function emitProgress(stage: string, detail: string, current: number, total: number) {
  if (_progressWriter) _progressWriter({ stage, detail, current, total });
}

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
    // templateId resolves to workUnitTemplate for template tools, interviewTemplate otherwise
    if (args.templateId) {
      if (toolName === 'create_work_unit_from_template') {
        args.templateId = await resolveId('workUnitTemplate', args.templateId, companyId);
      } else {
        args.templateId = await resolveId('interviewTemplate', args.templateId, companyId);
      }
    }
    if (args.interviewTemplateId) args.interviewTemplateId = await resolveId('interviewTemplate', args.interviewTemplateId, companyId);
    if (args.questionId) args.questionId = await resolveId('question', args.questionId);
    if (args.sessionId) args.sessionId = await resolveId('interviewSession', args.sessionId);
    if (args.invoiceId) args.invoiceId = await resolveId('invoice', args.invoiceId);
    if (args.contractId) args.contractId = await resolveId('legalAgreement', args.contractId, companyId);
    if (args.studentId) args.studentId = await resolveId('studentProfile', args.studentId);
    if (args.groupId) args.groupId = await resolveId('workflowGroup', args.groupId, companyId);
    if (args.notificationId) args.notificationId = await resolveId('notification', args.notificationId);
    // Resolve arrays of work unit IDs (for assign_to_workflow_group, create_workflow_group)
    if (args.workUnitIds?.length) {
      const resolved: string[] = [];
      for (const id of args.workUnitIds) {
        const full = await resolveId('workUnit', id, companyId);
        if (full) resolved.push(full);
      }
      args.workUnitIds = resolved;
    }
    if (args.addWorkUnitIds?.length) {
      const resolved: string[] = [];
      for (const id of args.addWorkUnitIds) {
        const full = await resolveId('workUnit', id, companyId);
        if (full) resolved.push(full);
      }
      args.addWorkUnitIds = resolved;
    }
    if (args.removeWorkUnitIds?.length) {
      const resolved: string[] = [];
      for (const id of args.removeWorkUnitIds) {
        const full = await resolveId('workUnit', id, companyId);
        if (full) resolved.push(full);
      }
      args.removeWorkUnitIds = resolved;
    }
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
      case 'set_publish_schedule':
        return await toolSetPublishSchedule(args, companyId);
      case 'get_publish_status':
        return await toolGetPublishStatus(args, companyId);
      case 'setup_dependency_chain':
        return await toolSetupDependencyChain(args, companyId);
      case 'setup_parallel_dependencies':
        return await toolSetupParallelDependencies(args, companyId);
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
      // Workflow Groups
      case 'create_workflow_group': return await toolCreateWorkflowGroup(args, companyId);
      case 'update_workflow_group': return await toolUpdateWorkflowGroup(args, companyId);
      case 'assign_to_workflow_group': return await toolAssignToWorkflowGroup(args, companyId);
      case 'list_workflow_groups': return await toolListWorkflowGroups(companyId);
      case 'delete_workflow_group': return await toolDeleteWorkflowGroup(args, companyId);
      case 'auto_layout_workflow': return await toolAutoLayoutWorkflow(args, companyId);
      // Planning
      case 'plan_analyze': return await toolPlanAnalyze(args, companyId);
      case 'plan_decompose': return await toolPlanDecompose(args, companyId);
      case 'plan_price': return await toolPlanPrice(args, companyId);
      case 'plan_legal': return await toolPlanLegal(args, companyId);
      case 'plan_execute': return await toolPlanExecute(companyId);
      case 'web_search': return await toolWebSearch(args);
      case 'get_company_profile': return await toolGetCompanyProfile(companyId);
      case 'update_company_profile': return await toolUpdateCompanyProfile(args, companyId);
      case 'list_disputes': return await toolListDisputes(companyId);
      case 'file_dispute': return await toolFileDispute(args, companyId);
      // Company Panel Tools
      case 'mark_notification_read': return await toolMarkNotificationRead(args, companyId);
      case 'mark_all_notifications_read': return await toolMarkAllNotificationsRead(companyId);
      case 'export_work_units': return await toolExportWorkUnits(companyId);
      case 'export_executions': return await toolExportExecutions(companyId);
      case 'bulk_update_work_units': return await toolBulkUpdateWorkUnits(args, companyId);
      case 'bulk_publish_work_units': return await toolBulkPublishWorkUnits(args, companyId);
      case 'bulk_assign_contractor': return await toolBulkAssignContractor(args, companyId);
      case 'archive_work_unit': return await toolArchiveWorkUnit(args, companyId);
      case 'restore_work_unit': return await toolRestoreWorkUnit(args, companyId);
      case 'list_archived_work_units': return await toolListArchivedWorkUnits(companyId);
      case 'save_work_unit_template': return await toolSaveWorkUnitTemplate(args, companyId);
      case 'list_work_unit_templates': return await toolListWorkUnitTemplates(companyId);
      case 'create_work_unit_from_template': return await toolCreateWorkUnitFromTemplate(args, companyId);
      case 'set_contractor_preference': return await toolSetContractorPreference(args, companyId);
      case 'list_contractor_preferences': return await toolListContractorPreferences(companyId);
      case 'get_contractor_history': return await toolGetContractorHistory(args, companyId);
      case 'get_activity_log': return await toolGetActivityLog(args, companyId);
      // Execution Messaging
      case 'send_message_to_contractor': return await toolSendMessageToContractor(args, companyId, userId);
      case 'get_execution_messages': return await toolGetExecutionMessages(args, companyId);
      default:
        return `Unknown tool "${toolName}". This tool does not exist. Available tools for your current context: ${TOOL_DEFINITIONS.map(t => t.function.name).join(', ')}. Re-read the user's request and pick the correct tool.`;
    }
  } catch (err: any) {
    const msg = err.message || 'Tool execution failed';
    // Give the model actionable info so it can recover
    if (msg.includes('not found')) {
      return `Error: ${msg}. Try calling list_work_units or list_all_executions to find the correct ID.`;
    }
    if (msg.includes('permission') || msg.includes('forbidden')) {
      return `Error: ${msg}. This operation requires different permissions.`;
    }
    return `Error executing ${toolName}: ${msg.slice(0, 300)}. Try again with corrected parameters or ask the user for clarification.`;
  }
}

// --- Tool implementations ---

async function toolCreateWorkUnit(args: any, companyId: string): Promise<string> {
  // Resolve dependency IDs inside publishConditions
  if (args.publishConditions?.dependencies?.length) {
    for (const dep of args.publishConditions.dependencies) {
      if (dep.workUnitId) {
        const resolved = await resolveId('workUnit', dep.workUnitId, companyId);
        if (resolved) dep.workUnitId = resolved;
      }
    }
  }
  // Validate publish conditions if provided (before creating)
  if (args.publishConditions) {
    const validation = await validatePublishConditions(args.publishConditions, companyId);
    if (!validation.valid) {
      return `Failed to create work unit: ${validation.error}`;
    }
  }

  const wu = await (db.workUnit as any).create({
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
      deliverableCount: args.deliverableCount || args.quantity || 1,
      status: 'draft',
      assignmentMode: args.assignmentMode || 'auto',
      hasExamples: !!(args.exampleUrls?.length),
      exampleUrls: args.exampleUrls || [],
      preferredHistory: args.preferredHistory || 0,
      maxRevisionTendency: args.maxRevisionTendency || 0.3,
      infoCollectionTemplateId: args.interviewTemplateId || null,
      scheduledPublishAt: args.scheduledPublishAt ? new Date(args.scheduledPublishAt) : null,
      publishConditions: args.publishConditions ? (args.publishConditions as any) : null,
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

  const schedInfo = wu.scheduledPublishAt ? `, scheduled: ${new Date(wu.scheduledPublishAt).toISOString()}` : '';
  const depsInfo = wu.publishConditions ? `, has dependency conditions` : '';
  return `Created "${wu.title}" [${wu.id.slice(0, 8)}] — $${(wu.priceInCents / 100).toFixed(2)}, ${wu.deadlineHours}h deadline, ${wu.category}, complexity ${wu.complexityScore}, status: draft${schedInfo}${depsInfo}. Full ID: ${wu.id}`;
}

async function toolUpdateWorkUnit(args: any, companyId: string): Promise<string> {
  const { workUnitId, ...updates } = args;
  const wu = await db.workUnit.findFirst({ where: { id: workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';

  const data: any = {};
  const fields = [
    'title', 'spec', 'category', 'status', 'priceInCents', 'deadlineHours',
    'minTier', 'complexityScore', 'revisionLimit', 'deliverableCount', 'assignmentMode',
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
  if (updates.interviewTemplateId !== undefined) data.infoCollectionTemplateId = updates.interviewTemplateId || null; // empty string → null for UUID column

  // Handle scheduledPublishAt
  if (updates.scheduledPublishAt !== undefined) {
    data.scheduledPublishAt = updates.scheduledPublishAt ? new Date(updates.scheduledPublishAt) : null;
  }

  // Handle publishConditions — resolve short IDs inside dependencies
  if (updates.publishConditions !== undefined) {
    if (updates.publishConditions === null) {
      data.publishConditions = null;
    } else {
      // Resolve dependency workUnitIds (agent passes short IDs)
      if (updates.publishConditions.dependencies?.length) {
        for (const dep of updates.publishConditions.dependencies) {
          if (dep.workUnitId) {
            const resolved = await resolveId('workUnit', dep.workUnitId, companyId);
            if (resolved) dep.workUnitId = resolved;
          }
        }
      }
      // Validate before updating
      const validation = await validatePublishConditions(updates.publishConditions, companyId, workUnitId);
      if (!validation.valid) {
        return `Failed to update work unit: ${validation.error}`;
      }
      data.publishConditions = updates.publishConditions;
    }
  }

  if (updates.status === 'active') data.publishedAt = new Date();

  const updated = await db.workUnit.update({ where: { id: workUnitId }, data });

  // Sync escrow on price or deliverable count change
  if (data.priceInCents || data.deliverableCount) {
    const price = updated.priceInCents;
    const feePercent = updated.platformFeePercent || 0.15;
    const fee = Math.round(price * feePercent);
    await db.escrow.updateMany({
      where: { workUnitId },
      data: { amountInCents: price, platformFeeInCents: fee, netAmountInCents: price - fee },
    });
  }

  // Sync escrow on status change
  if (data.status === 'cancelled') {
    await db.escrow.updateMany({ where: { workUnitId, status: { in: ['pending', 'funded'] } }, data: { status: 'refunded', releasedAt: new Date() } });
  } else if (data.status === 'paused') {
    // Keep escrow funded but mark as held
    // No change needed — escrow stays funded, just task is paused
  } else if (data.status === 'active' && wu.status === 'paused') {
    // Unpausing — escrow should already be funded, no change needed
  }

  const changes = Object.keys(data).filter(k => k !== 'publishedAt').join(', ');
  return `Updated "${updated.title}" [${updated.id.slice(0, 8)}] — changed: ${changes}. Status: ${updated.status}, $${(updated.priceInCents / 100).toFixed(2)}, ${updated.deadlineHours}h. Full ID: ${updated.id}`;
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
    const currentYear = new Date().getFullYear();
    const searchQuery = `freelance hourly rate ${taskDescription} ${currentYear}`;
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
  const where: any = { companyId, archivedAt: null };
  if (args.status) where.status = args.status;

  const units = await (db.workUnit as any).findMany({
    where,
    select: {
      id: true, title: true, status: true, priceInCents: true, deadlineHours: true,
      category: true, complexityScore: true, minTier: true, spec: true,
      publishConditions: true, scheduledPublishAt: true, workflowGroupId: true,
      requiredSkills: true,
      executions: { select: { id: true, status: true, student: { select: { name: true } } }, where: { status: { notIn: ['cancelled'] } }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  if (units.length === 0) return 'No work units found.';

  return units.map((u: any) => {
    const exec = u.executions?.[0];
    const deps = (u.publishConditions as any)?.dependencies || [];
    const depInfo = deps.length > 0 ? ` | depends on: ${deps.map((d: any) => `${d.workUnitId?.slice(0, 8)}(${d.condition || 'completed'})`).join(', ')}` : '';
    const execInfo = exec ? ` | contractor: ${exec.student?.name} (${exec.status})` : '';
    const schedInfo = u.scheduledPublishAt ? ` | scheduled: ${new Date(u.scheduledPublishAt).toLocaleDateString()}` : '';
    const skills = u.requiredSkills?.length ? ` | skills: ${u.requiredSkills.join(', ')}` : '';
    const specPreview = u.spec ? ` | spec: "${u.spec.slice(0, 120)}${u.spec.length > 120 ? '...' : ''}"` : '';
    const groupInfo = u.workflowGroupId ? ` | group: ${u.workflowGroupId.slice(0, 8)}` : '';
    return `[${u.id.slice(0, 8)}] "${u.title}" — ${u.status}, $${(u.priceInCents / 100).toFixed(0)}, ${u.deadlineHours}h, ${u.category}, tier: ${u.minTier}, complexity: ${u.complexityScore}${skills}${depInfo}${execInfo}${schedInfo}${groupInfo}${specPreview}`;
  }).join('\n');
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

  const where: any = { tier: { in: canDoTiers } };
  if (assignedIds.length > 0) {
    where.id = { notIn: assignedIds };
  }
  const students = await db.studentProfile.findMany({
    where,
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

  return `Published "${wu.title}", $${(wu.priceInCents / 100).toFixed(2)} funded.`;
}

async function toolSetPublishSchedule(args: any, companyId: string): Promise<string> {
  const { workUnitId, scheduledPublishAt, publishConditions } = args;
  const wu = await db.workUnit.findFirst({ where: { id: workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';

  // Resolve dependency workUnitIds inside publishConditions (agent passes short IDs)
  if (publishConditions?.dependencies?.length) {
    for (const dep of publishConditions.dependencies) {
      if (dep.workUnitId) {
        const resolved = await resolveId('workUnit', dep.workUnitId, companyId);
        if (resolved) dep.workUnitId = resolved;
        else return `Could not find dependency work unit "${dep.workUnitId}". Use list_work_units to check IDs.`;
      }
    }
  }

  // Validate publish conditions if provided
  if (publishConditions !== undefined && publishConditions !== null) {
    const validation = await validatePublishConditions(publishConditions, companyId, workUnitId);
    if (!validation.valid) {
      return `Failed to set publish schedule: ${validation.error}`;
    }
  }

  const updateData: any = {};
  if (scheduledPublishAt !== undefined) {
    updateData.scheduledPublishAt = scheduledPublishAt ? new Date(scheduledPublishAt) : null;
  }
  if (publishConditions !== undefined) {
    updateData.publishConditions = publishConditions ? (publishConditions as any) : null;
  }

  await db.workUnit.update({
    where: { id: workUnitId },
    data: updateData,
  });

  const parts: string[] = [];
  if (scheduledPublishAt !== undefined) {
    parts.push(scheduledPublishAt ? `scheduled for ${new Date(scheduledPublishAt).toISOString()}` : 'scheduled publish cleared');
  }
  if (publishConditions !== undefined) {
    parts.push(publishConditions ? `${publishConditions.dependencies?.length || 0} dependency condition(s) set` : 'publish conditions cleared');
  }

  return `Updated publish schedule for "${wu.title}": ${parts.join(', ')}.`;
}

async function toolGetPublishStatus(args: any, companyId: string): Promise<string> {
  const { workUnitId } = args;
  const wu = await (db.workUnit as any).findFirst({ where: { id: workUnitId, companyId }, include: { escrow: true } });
  if (!wu) return 'Work unit not found.';

  const { met, details } = await evaluatePublishConditions(workUnitId);
  const dependents = await getDependentWorkUnits(workUnitId);

  let status = `Publish status for "${wu.title}":\n`;
  
  if (wu.scheduledPublishAt) {
    const scheduled = new Date(wu.scheduledPublishAt);
    const now = new Date();
    if (scheduled <= now) {
      status += `- Scheduled time: ${scheduled.toISOString()} (PASSED)\n`;
    } else {
      status += `- Scheduled time: ${scheduled.toISOString()} (${Math.round((scheduled.getTime() - now.getTime()) / 1000 / 60)} minutes remaining)\n`;
    }
  } else {
    status += `- No scheduled publish time\n`;
  }

  if (wu.publishConditions) {
    const conditions = wu.publishConditions as any as PublishConditions;
    status += `- Dependency logic: ${conditions.logic}\n`;
    status += `- Dependencies (${details.length}):\n`;
    for (const dep of details) {
      status += `  ${dep.met ? '✓' : '✗'} ${dep.workUnitTitle}: ${dep.condition} — ${dep.reason}\n`;
    }
    status += `- All conditions met: ${met ? 'YES' : 'NO'}\n`;
  } else {
    status += `- No publish conditions\n`;
  }

  if (dependents.length > 0) {
    status += `- Tasks depending on this one (${dependents.length}): ${dependents.map(d => `${d.title} (${d.status})`).join(', ')}\n`;
  }

  const escrowFunded = wu.escrow?.status === 'funded';
  if (wu.scheduledPublishAt || wu.publishConditions) {
    const scheduledTimePassed = wu.scheduledPublishAt ? new Date(wu.scheduledPublishAt) <= new Date() : false;
    const ready = (scheduledTimePassed && met) || (met && !wu.scheduledPublishAt) || (scheduledTimePassed && !wu.publishConditions);
    status += `- Can publish now: ${ready && escrowFunded ? 'YES' : 'NO'}\n`;
    if (!ready || !escrowFunded) {
      const reasons: string[] = [];
      if (!escrowFunded) reasons.push('escrow not funded');
      if (wu.scheduledPublishAt && !scheduledTimePassed) reasons.push('waiting for scheduled time');
      if (wu.publishConditions && !met) reasons.push('dependency conditions not met');
      status += `  Blocked: ${reasons.join(', ')}\n`;
    }
  } else {
    status += `- Can publish manually: ${wu.status === 'draft' && escrowFunded ? 'YES' : 'NO'}\n`;
  }

  return status;
}

async function toolSetupDependencyChain(args: any, companyId: string): Promise<string> {
  const ids: string[] = args.workUnitIds || [];
  if (ids.length < 2) return 'Need at least 2 work unit IDs to create a chain. Call list_work_units first to get the IDs.';

  const condition = args.condition || 'completed';
  const shareContext = args.shareContext || 'summary';
  const results: string[] = [];

  // Resolve all IDs first
  const resolvedIds: string[] = [];
  for (const id of ids) {
    const full = await resolveId('workUnit', id, companyId);
    if (!full) return `Could not find work unit "${id}". Call list_work_units to see available tasks and their IDs.`;
    resolvedIds.push(full);
  }

  // Verify ALL resolved IDs belong to this company
  const wus = await db.workUnit.findMany({
    where: { id: { in: resolvedIds }, companyId },
    select: { id: true, title: true, status: true },
  });
  if (wus.length !== resolvedIds.length) {
    const found = new Set(wus.map(w => w.id));
    const missing = resolvedIds.filter(id => !found.has(id)).map(id => id.slice(0, 8));
    return `${missing.length} work unit(s) not found or don't belong to your company: ${missing.join(', ')}. Call list_work_units to verify.`;
  }
  const titleMap = new Map(wus.map(w => [w.id, w.title]));

  // Set up chain: each task depends on the previous one
  for (let i = 1; i < resolvedIds.length; i++) {
    const depId = resolvedIds[i - 1];
    const wuId = resolvedIds[i];

    try {
      await (db.workUnit as any).update({
        where: { id: wuId },
        data: {
          publishConditions: {
            logic: 'AND',
            dependencies: [{ workUnitId: depId, condition, shareContext }],
          },
        },
      });
      results.push(`${titleMap.get(depId) || depId.slice(0, 8)} → ${titleMap.get(wuId) || wuId.slice(0, 8)}`);
    } catch (err: any) {
      results.push(`Failed: ${titleMap.get(wuId) || wuId.slice(0, 8)} — ${err?.message?.slice(0, 40)}`);
    }
  }

  return `Dependency chain set (${condition}, ${shareContext} sharing):\n${results.join('\n')}\n\n${resolvedIds.length - 1} connections created. Tasks will auto-publish in sequence.`;
}

async function toolSetupParallelDependencies(args: any, companyId: string): Promise<string> {
  const deps: Array<{ workUnitId: string; dependsOn: Array<{ workUnitId: string; condition?: string; shareContext?: string; onFailure?: string }> }> = args.dependencies || [];
  if (deps.length === 0) return 'No dependencies provided. Pass an array of tasks with their dependency configurations.';

  const results: string[] = [];
  const errors: string[] = [];

  // Phase 1: Resolve ALL referenced IDs upfront (batch)
  const allRawIds = new Set<string>();
  for (const depConfig of deps) {
    allRawIds.add(depConfig.workUnitId);
    for (const dep of depConfig.dependsOn || []) {
      allRawIds.add(dep.workUnitId);
    }
  }

  // Resolve short IDs → full UUIDs
  const resolvedMap = new Map<string, string>(); // raw → full UUID
  for (const rawId of Array.from(allRawIds)) {
    const resolved = await resolveId('workUnit', rawId, companyId);
    if (resolved) resolvedMap.set(rawId, resolved);
  }

  // Batch fetch all resolved work units for verification + title mapping
  const allResolvedIds = Array.from(new Set(resolvedMap.values()));
  const wus = await db.workUnit.findMany({
    where: { id: { in: allResolvedIds }, companyId },
    select: { id: true, title: true },
  });
  const titleMap = new Map(wus.map(w => [w.id, w.title]));
  const validIds = new Set(wus.map(w => w.id));

  // Phase 2: Process each dependency configuration
  for (const depConfig of deps) {
    const rawWuId = depConfig.workUnitId;
    const dependsOn = depConfig.dependsOn || [];

    const resolvedWuId = resolvedMap.get(rawWuId);
    if (!resolvedWuId || !validIds.has(resolvedWuId)) {
      errors.push(`Could not find work unit "${rawWuId}" in your company`);
      continue;
    }
    const wuTitle = titleMap.get(resolvedWuId) || resolvedWuId.slice(0, 8);

    // Empty dependsOn = clear dependencies
    if (dependsOn.length === 0) {
      try {
        await (db.workUnit as any).update({
          where: { id: resolvedWuId },
          data: { publishConditions: null },
        });
        results.push(`Cleared dependencies for "${wuTitle}"`);
      } catch (err: any) {
        errors.push(`Failed to clear "${wuTitle}": ${err?.message?.slice(0, 60)}`);
      }
      continue;
    }

    // Resolve + validate each dependency
    const resolvedDeps: Array<{ workUnitId: string; condition: string; shareContext: string; onFailure?: string }> = [];
    for (const dep of dependsOn) {
      const resolvedDepId = resolvedMap.get(dep.workUnitId);
      if (!resolvedDepId || !validIds.has(resolvedDepId)) {
        errors.push(`Dependency "${dep.workUnitId}" for "${wuTitle}" not found`);
        continue;
      }
      // Prevent self-dependency
      if (resolvedDepId === resolvedWuId) {
        errors.push(`"${wuTitle}" cannot depend on itself`);
        continue;
      }

      resolvedDeps.push({
        workUnitId: resolvedDepId,
        condition: dep.condition || 'completed',
        shareContext: dep.shareContext || 'summary',
        ...(dep.condition === 'failed' && dep.onFailure ? { onFailure: dep.onFailure } : {}),
      });
    }

    if (resolvedDeps.length === 0) {
      errors.push(`No valid dependencies resolved for "${wuTitle}"`);
      continue;
    }

    // Always set logic for consistency with evaluatePublishConditions
    const logic = resolvedDeps.length > 1 ? 'AND' : 'AND';

    try {
      await (db.workUnit as any).update({
        where: { id: resolvedWuId },
        data: {
          publishConditions: {
            logic,
            dependencies: resolvedDeps,
          },
        },
      });

      const depTitles = resolvedDeps.map(d => {
        return `"${titleMap.get(d.workUnitId) || d.workUnitId.slice(0, 8)}" (${d.condition}, ${d.shareContext})`;
      });
      results.push(`"${wuTitle}" depends on: ${depTitles.join(' + ')}`);
    } catch (err: any) {
      errors.push(`Failed to set deps for "${wuTitle}": ${err?.message?.slice(0, 60)}`);
    }
  }

  // Build output
  let output = '';
  if (results.length > 0) {
    output += `Parallel dependencies configured:\n${results.join('\n')}\n\n`;
  }
  if (errors.length > 0) {
    output += `Errors:\n${errors.join('\n')}\n\n`;
  }
  const totalDeps = deps.reduce((sum, d) => sum + (d.dependsOn?.length || 0), 0);
  output += `${results.length} task(s) configured with ${totalDeps} total dependency links.`;
  return output;
}

async function toolDeleteWorkUnit(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({
    where: { id: args.workUnitId, companyId },
    include: {
      executions: true, // ALL executions, not filtered
      escrow: true,
    },
  });
  if (!wu) return 'Work unit not found.';

  // Block if there are actively running executions (assigned, clocked_in, submitted)
  const activeExecs = wu.executions.filter(e => ['assigned', 'clocked_in', 'submitted', 'revision_needed'].includes(e.status));
  if (activeExecs.length > 0) {
    return `Cannot delete "${wu.title}" — it has ${activeExecs.length} actively running execution(s). Cancel them first.`;
  }

  // Auto-cancel the work unit if not already cancelled/draft
  if (!['cancelled', 'draft'].includes(wu.status)) {
    await db.workUnit.update({ where: { id: wu.id }, data: { status: 'cancelled' } });
  }

  // Refund escrow
  if (wu.escrow && ['pending', 'funded'].includes(wu.escrow.status)) {
    await db.escrow.update({ where: { id: wu.escrow.id }, data: { status: 'refunded', releasedAt: new Date() } });
  }

  // Delete ALL related records in order (respecting foreign keys)
  try {
    // Delete execution-related records first
    for (const exec of wu.executions) {
      await db.proofOfWorkLog.deleteMany({ where: { executionId: exec.id } });
      await db.revisionRequest.deleteMany({ where: { executionId: exec.id } });
      await db.taskMilestone.deleteMany({ where: { executionId: exec.id } });
      await db.dispute.deleteMany({ where: { executionId: exec.id } });
    }
    // Delete executions
    await db.execution.deleteMany({ where: { workUnitId: wu.id } });
    // Delete other work unit children
    await db.milestoneTemplate.deleteMany({ where: { workUnitId: wu.id } });
    await db.defectAnalysis.deleteMany({ where: { workUnitId: wu.id } });
    await db.agentConversation.deleteMany({ where: { workUnitId: wu.id } });
    await db.paymentTransaction.deleteMany({ where: { workUnitId: wu.id } });
    if (wu.escrow) await db.escrow.delete({ where: { id: wu.escrow.id } });
  } catch (e: any) {
    return `Failed to clean up "${wu.title}": ${e.message?.slice(0, 100)}. Try again.`;
  }

  // Now safe to delete the work unit
  try {
    await db.workUnit.delete({ where: { id: wu.id } });
    return `Deleted "${wu.title}" and all related records.`;
  } catch (e: any) {
    return `Failed to delete "${wu.title}": ${e.message?.slice(0, 100)}`;
  }
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
  const { randomBytes } = await import('crypto');
  const token = randomBytes(16).toString('hex');
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
    (db.workUnit as any).count({ where: { companyId, archivedAt: null } }),
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
  // Embed work unit ID in slug for per-work-unit filtering
  const wuPrefix = args.workUnitId ? `wu-${args.workUnitId.slice(0, 8)}-` : '';
  const slug = wuPrefix + args.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '-' + Date.now().toString(36);

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

  // Auto-activate if requested (saves a second tool call and prevents wrong-ID bugs)
  if (args.activate) {
    await db.legalAgreement.update({ where: { id: agreement.id }, data: { status: 'active' } });
    return `Created AND activated contract "${agreement.title}" [${agreement.id.slice(0, 8)}]. Status: active. Contractors must sign before starting. Full ID: ${agreement.id}`;
  }

  return `Created contract "${agreement.title}" [${agreement.id.slice(0, 8)}]. Status: draft. Call activate_contract with contractId "${agreement.id.slice(0, 8)}" to make it required. Full ID: ${agreement.id}`;
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
  if (a.status === 'active') return `"${a.title}" already active.`;

  await db.legalAgreement.update({ where: { id: args.contractId }, data: { status: 'active' } });
  return `Activated "${a.title}".`;
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

  // Get work unit context for auto-generation
  const wu = args.workUnitId ? await db.workUnit.findFirst({
    where: { id: args.workUnitId, companyId },
    select: { title: true, spec: true, category: true, requiredSkills: true, deliverableFormat: true, acceptanceCriteria: true },
  }) : null;

  let rawBlocks = args.blocks || [];

  // AUTO-GENERATE MODE: if description is provided (or blocks are empty), use GPT to generate blocks
  if (args.description || rawBlocks.length === 0) {
    const desc = args.description || 'Create a professional onboarding page for this task.';
    const wuContext = wu ? `Task: "${wu.title}"\nCategory: ${wu.category}\nSpec: ${(wu.spec || '').slice(0, 500)}\nSkills: ${(wu.requiredSkills || []).join(', ')}\nDeliverables: ${(wu.deliverableFormat || []).join(', ')}` : '';

    try {
      const openai = getOpenAIClient();
      const genRes = await openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [
          { role: 'system', content: `You generate onboarding pages. Return a JSON object: {"blocks": [...]}
Each block has {type, content}. Types:
- hero: {heading:"Welcome!",subheading:"Get started here"}
- text: {heading:"Section Title",body:"Detailed instructions. Use [link text](url) for links."}
- checklist: {heading:"Before You Start",items:["Step 1","Step 2","Step 3"]}
- cta: {heading:"Ready?",body:"Click below to begin",buttonText:"Start Working"}
- divider: {}

Generate 4-8 blocks with REAL, SPECIFIC content based on the task. Write full paragraphs for text blocks. Include specific checklist items. Make it professional and useful for a contractor.` },
          { role: 'user', content: `Create onboarding page:\n${desc}\n\n${wuContext}` },
        ],
        max_completion_tokens: 3000,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      });

      const raw = genRes.choices[0]?.message?.content || '{}';
      console.log(`[Onboarding] GPT raw response: ${raw.slice(0, 300)}`);
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch (e) {
        console.error(`[Onboarding] JSON parse failed: ${raw.slice(0, 200)}`);
        // Try to extract array from markdown code block
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          try { parsed = { blocks: JSON.parse(match[0]) }; } catch { parsed = {}; }
        } else {
          parsed = {};
        }
      }
      const generated = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.blocks) ? parsed.blocks
        : Array.isArray(parsed.page) ? parsed.page
        : Array.isArray(parsed.data) ? parsed.data
        : [];
      if (generated.length > 0) {
        rawBlocks = generated;
        console.log(`[Onboarding] Auto-generated ${generated.length} blocks from description`);
      } else {
        console.error(`[Onboarding] No blocks extracted from: ${raw.slice(0, 200)}`);
        return `Auto-generation returned no blocks. GPT response: "${raw.slice(0, 150)}...". Retry with a more specific description, e.g.: "Welcome page for [task]. Include brand link [url], checklist with [items], and CTA to start."`;
      }
    } catch (genErr: any) {
      console.error(`[Onboarding] Generation error: ${genErr?.message}`);
      return `Failed to generate onboarding page: ${genErr?.message?.slice(0, 200)}. Retry or use manual blocks.`;
    }
  }

  if (rawBlocks.length === 0) return 'No blocks provided. Pass a "description" string (preferred) or a "blocks" array.';

  // Validate blocks have actual content — reject empty ones
  const validBlocks: any[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    const b = rawBlocks[i];
    if (!b.type) { warnings.push(`Block ${i + 1}: missing type, skipped`); continue; }
    const content = b.content || {};
    const contentKeys = Object.keys(content);
    const hasContent = b.type === 'divider' || contentKeys.some(k => {
      const v = content[k];
      return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
    });
    if (!hasContent && b.type !== 'divider') {
      warnings.push(`Block ${i + 1} (${b.type}): empty content — needs ${
        b.type === 'hero' ? 'heading + subheading' :
        b.type === 'text' ? 'heading + body' :
        b.type === 'checklist' ? 'heading + items[]' :
        b.type === 'cta' ? 'heading + body + buttonText' :
        b.type === 'image' ? 'url + caption' :
        b.type === 'video' ? 'url + title' :
        b.type === 'file' ? 'url + filename' : 'content fields'
      }`);
      continue; // Skip empty blocks
    }
    validBlocks.push({
      id: `ai-${Date.now()}-${i}`,
      type: b.type,
      content,
    });
  }

  if (validBlocks.length === 0) {
    return `All ${rawBlocks.length} blocks were empty (no text content). You must include actual content in each block. Examples:\n` +
      `- hero: {heading: "Welcome to the Team!", subheading: "Here's everything you need to get started"}\n` +
      `- text: {heading: "Instructions", body: "Follow these steps to complete your work..."}\n` +
      `- checklist: {heading: "Before You Start", items: ["Read the brief", "Review examples", "Set up tools"]}\n` +
      `- cta: {heading: "Ready?", body: "Click below to begin", buttonText: "Start Working"}\n` +
      `Retry set_onboarding with filled content.`;
  }

  const existing = (typeof company.address === 'object' && company.address) || {};
  const onboardingPages = (existing as any).onboardingPages || {};
  const prev = onboardingPages[args.workUnitId] || {};
  onboardingPages[args.workUnitId] = {
    ...prev,
    accentColor: args.accentColor || prev.accentColor || '#a78bfa',
    blocks: validBlocks,
  };

  await db.companyProfile.update({
    where: { id: companyId },
    data: { address: { ...existing, onboardingPages } as any },
  });

  const blockSummary = validBlocks.map((b: any) => {
    const c = b.content;
    const preview = c.heading || c.body?.slice(0, 40) || c.items?.length ? `${c.items?.length} items` : '';
    return `${b.type}${preview ? `: "${preview}"` : ''}`;
  }).join(', ');
  const warningStr = warnings.length > 0 ? `\n⚠ Skipped ${warnings.length} empty block(s): ${warnings.join('; ')}` : '';
  return `Updated onboarding page with ${validBlocks.length} blocks (${blockSummary}). Accent: ${onboardingPages[args.workUnitId].accentColor}.${warningStr}`;
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

// ============================================================
// ============================================================
// WORKFLOW GROUPS
// ============================================================

async function toolCreateWorkflowGroup(args: any, companyId: string): Promise<string> {
  // Check for existing group with similar name to prevent duplicates
  const existing = await (db as any).workflowGroup.findFirst({
    where: { companyId, name: { contains: args.name?.split('—')[0]?.trim() || args.name, mode: 'insensitive' } },
    include: { workUnits: { select: { id: true } } },
  });
  if (existing && existing.workUnits.length > 0) {
    // If a similar group already has tasks, assign to it instead of creating a duplicate
    if (args.workUnitIds?.length) {
      await (db.workUnit as any).updateMany({
        where: { id: { in: args.workUnitIds }, companyId },
        data: { workflowGroupId: existing.id },
      });
      return `Added ${args.workUnitIds.length} task(s) to existing space "${existing.name}" [${existing.id.slice(0, 8)}] instead of creating a duplicate.`;
    }
    return `Workflow space "${existing.name}" already exists with ${existing.workUnits.length} task(s). Use assign_to_workflow_group to add tasks to it.`;
  }

  // Warn if creating empty group
  if (!args.workUnitIds?.length) {
    return 'Cannot create an empty workflow space. Include workUnitIds with at least 1 work unit ID.';
  }

  const group = await (db as any).workflowGroup.create({
    data: {
      companyId,
      name: args.name,
      description: args.description || null,
      color: args.color || '#6366f1',
    },
  });

  await (db.workUnit as any).updateMany({
    where: { id: { in: args.workUnitIds }, companyId },
    data: { workflowGroupId: group.id },
  });

  const count = args.workUnitIds?.length || 0;
  return `Created workflow space "${group.name}" [${group.id.slice(0, 8)}]${count > 0 ? ` with ${count} task(s)` : ''}. The user can view and arrange tasks visually at /dashboard/workunits/workflow.`;
}

async function toolUpdateWorkflowGroup(args: any, companyId: string): Promise<string> {
  const group = await (db as any).workflowGroup.findFirst({ where: { id: args.groupId, companyId } });
  if (!group) return 'Workflow group not found.';

  const data: any = {};
  if (args.name !== undefined) data.name = args.name;
  if (args.description !== undefined) data.description = args.description;
  if (args.color !== undefined) data.color = args.color;

  await (db as any).workflowGroup.update({ where: { id: args.groupId }, data });
  return `Updated workflow space "${args.name || group.name}".`;
}

async function toolAssignToWorkflowGroup(args: any, companyId: string): Promise<string> {
  const group = await (db as any).workflowGroup.findFirst({ where: { id: args.groupId, companyId } });
  if (!group) return 'Workflow group not found.';

  const results: string[] = [];
  if (args.addWorkUnitIds?.length) {
    await (db.workUnit as any).updateMany({
      where: { id: { in: args.addWorkUnitIds }, companyId },
      data: { workflowGroupId: args.groupId },
    });
    results.push(`Added ${args.addWorkUnitIds.length} work unit(s)`);
  }
  if (args.removeWorkUnitIds?.length) {
    await (db.workUnit as any).updateMany({
      where: { id: { in: args.removeWorkUnitIds }, companyId, workflowGroupId: args.groupId },
      data: { workflowGroupId: null },
    });
    results.push(`Removed ${args.removeWorkUnitIds.length} work unit(s)`);
  }

  return `Updated space "${group.name}": ${results.join(', ')}. Changes are visible in the Workflow page.`;
}

async function toolListWorkflowGroups(companyId: string): Promise<string> {
  const groups = await (db as any).workflowGroup.findMany({
    where: { companyId },
    include: { workUnits: { select: { id: true, title: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });

  if (groups.length === 0) return 'No workflow spaces yet. Create one with create_workflow_group when you have 2+ tasks to organize.';

  return groups.map((g: any) => {
    const wuList = g.workUnits.map((wu: any) => `[${wu.id.slice(0, 8)}] ${wu.title} (${wu.status})`).join('\n  ');
    return `**${g.name}** [group:${g.id.slice(0, 8)}] — ${g.workUnits.length} task(s)\n  ${wuList || '(empty)'}`;
  }).join('\n\n');
}

async function toolDeleteWorkflowGroup(args: any, companyId: string): Promise<string> {
  const group = await (db as any).workflowGroup.findFirst({ where: { id: args.groupId, companyId } });
  if (!group) return 'Workflow group not found.';

  await (db.workUnit as any).updateMany({
    where: { workflowGroupId: args.groupId },
    data: { workflowGroupId: null },
  });
  await (db as any).workflowGroup.delete({ where: { id: args.groupId } });
  return `Deleted workflow space "${group.name}". Tasks were unassigned from the space but not deleted.`;
}

async function toolAutoLayoutWorkflow(args: any, companyId: string): Promise<string> {
  const groupId = args.groupId;
  const group = await (db as any).workflowGroup.findFirst({
    where: { id: groupId, companyId },
    include: { workUnits: { where: { archivedAt: null }, select: { id: true, title: true, publishConditions: true } } },
  });
  if (!group) return 'Workflow group not found.';

  const nodes = group.workUnits || [];
  if (nodes.length === 0) return 'No tasks in this workflow group.';

  // Build dependency graph
  const nodeIds = new Set(nodes.map((n: any) => n.id));
  const inDeps = new Map<string, string[]>();
  nodes.forEach((n: any) => inDeps.set(n.id, []));

  for (const n of nodes) {
    const pc = n.publishConditions as any;
    if (!pc?.dependencies) continue;
    for (const dep of pc.dependencies) {
      if (nodeIds.has(dep.workUnitId)) {
        inDeps.get(n.id)!.push(dep.workUnitId);
      }
    }
  }

  // Longest-path layering (same algorithm as frontend autoLayout)
  const layerMap = new Map<string, number>();
  function assignLayer(id: string, visited = new Set<string>()): number {
    if (layerMap.has(id)) return layerMap.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const deps = inDeps.get(id) || [];
    const layer = deps.length === 0 ? 0 : Math.max(...deps.map(d => assignLayer(d, visited) + 1));
    layerMap.set(id, layer);
    return layer;
  }
  nodes.forEach((n: any) => assignLayer(n.id));

  // Group by layer
  const layers: string[][] = [];
  Array.from(layerMap.entries()).forEach(([id, layer]) => {
    while (layers.length <= layer) layers.push([]);
    layers[layer].push(id);
  });
  for (const n of nodes) {
    if (!layerMap.has(n.id)) {
      if (!layers.length) layers.push([]);
      layers[0].push(n.id);
    }
  }

  // Calculate positions
  const NODE_W = 200, NODE_H = 88;
  const COL_GAP = NODE_W + 60;
  const ROW_GAP = NODE_H + 80;
  const maxLayerWidth = Math.max(...layers.map(l => l.length));
  const positions: Record<string, { x: number; y: number }> = {};

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const layerWidth = layer.length * COL_GAP;
    const totalWidth = maxLayerWidth * COL_GAP;
    const offsetX = (totalWidth - layerWidth) / 2;
    for (let ni = 0; ni < layer.length; ni++) {
      positions[layer[ni]] = {
        x: 30 + offsetX + ni * COL_GAP,
        y: 30 + li * ROW_GAP,
      };
    }
  }

  // Save positions to the workflow group
  await (db as any).workflowGroup.update({
    where: { id: groupId },
    data: { nodePositions: positions },
  });

  // Build summary
  const titleMap = new Map(nodes.map((n: any) => [n.id, n.title]));
  const layerSummary = layers.map((layer, i) => 
    `Layer ${i}: ${layer.map(id => titleMap.get(id) || id.slice(0, 8)).join(', ')}`
  ).join('\n');

  return `Auto-layout complete for "${group.name}" (${nodes.length} tasks, ${layers.length} layers).\n\n${layerSummary}\n\nThe board will refresh to show the new layout when the user visits the Workflow page.`;
}

// ============================================================
// MULTI-AGENT PROJECT PLANNER — server-side chained stages
// Each stage stores its output; next stage reads it directly.
// Agent just triggers each stage — no data passing through GPT.
// ============================================================

// Server-side plan state — keyed by companyId
const planState = new Map<string, { brief?: any; workUnits?: any[]; estimates?: any; legal?: any }>();

async function gpt52(systemPrompt: string, userPrompt: string, maxTokens: number = 4096): Promise<string> {
  const openai = getOpenAIClient();
  const res = await openai.chat.completions.create({
    model: 'gpt-5.2',
    messages: [
      { role: 'system', content: systemPrompt + '\nReturn ONLY valid JSON. No markdown, no explanation, no code fences.' },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });
  return res.choices[0]?.message?.content || '';
}

function parseJSON(raw: string): any {
  // Strip markdown code fences if present
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // Try direct parse first
  try { return JSON.parse(cleaned); } catch {}
  // Try extracting the outermost JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
    // Try finding the LAST complete JSON object (GPT sometimes outputs thinking then JSON)
    const allMatches = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
    if (allMatches) {
      for (let i = allMatches.length - 1; i >= 0; i--) {
        try { return JSON.parse(allMatches[i]); } catch {}
      }
    }
  }
  console.error('[parseJSON] Failed to parse:', cleaned.slice(0, 300));
  return {};
}

async function toolPlanAnalyze(args: any, companyId?: string): Promise<string> {
  const cid = companyId || 'default';
  const { goal, budget, timeline } = args;
  try {
    emitProgress('Analyzing', 'Reading project requirements', 1, 3);
    emitThinking('Analyzing the project goal and identifying constraints...');
    
    // Enhanced prompt with better structure and context
    const systemPrompt = `You are a senior project analyst specializing in breaking down complex projects into actionable work units.

Analyze the project request and produce a comprehensive brief. Consider:
1. **Project Type**: Determine if this is a campaign, hiring, content, research, development, or operations project
2. **Complexity**: Assess overall complexity (1-5 scale)
3. **Team Size**: Estimate how many contractors will be needed
4. **Constraints**: Identify budget, timeline, quality, and resource constraints
5. **Risk Factors**: Identify potential risks that could impact delivery
6. **Quality Bar**: Define the expected quality standard (basic, professional, premium)
7. **Industry Context**: Consider industry-specific requirements and best practices
8. **Workflow Type**: Determine the workflow pattern:
   - "parallel" = all tasks can run simultaneously (no dependencies)
   - "sequential" = tasks must complete in order (A → B → C)
   - "hybrid" = mix of parallel and sequential (some tasks depend on others, some run in parallel)
   - "iterative" = repeated cycles (draft → review → revise)
9. **Collaboration Needs**: Whether contractors on later tasks need context from earlier tasks
10. **Handoff Points**: Where outputs from one task become inputs for another

Return JSON with this structure:
{
  "projectName": "Clear, descriptive project name",
  "goal": "Detailed project goal and desired outcome",
  "projectType": "campaign|hiring|content|research|development|operations",
  "complexity": 1-5,
  "estimatedTeamSize": N,
  "constraints": ["constraint1", "constraint2"],
  "qualityBar": "basic|professional|premium",
  "riskFactors": ["risk1", "risk2"],
  "industryContext": "Brief description of industry-specific considerations",
  "successCriteria": ["criterion1", "criterion2"],
  "workflowType": "parallel|sequential|hybrid|iterative",
  "collaborationNeeds": "Description of how tasks should share context and outputs",
  "handoffPoints": ["Task A output feeds into Task B", "Task B deliverable is reviewed before Task C starts"]
}`;

    const userPrompt = `Project Request:
Goal: ${goal}
Budget: ${budget || 'flexible'}
Timeline: ${timeline || 'flexible'}

Analyze this project thoroughly. Consider what type of project this is, what deliverables will be needed, what skills are required, and what risks exist. Be specific and actionable.`;

    const raw = await gpt52(systemPrompt, userPrompt, 3072);
    const brief = parseJSON(raw);
    
    // Validate brief has required fields
    if (!brief.projectName || !brief.projectType) {
      emitThinking('⚠ Brief missing required fields, using defaults');
      brief.projectName = brief.projectName || 'Untitled Project';
      brief.projectType = brief.projectType || 'content';
    }
    
    planState.set(cid, { brief });
    emitProgress('Analyzing', `"${brief.projectName}" identified`, 3, 3);
    emitThinking(`Project: "${brief.projectName}" — ${brief.projectType}, complexity ${brief.complexity || 3}, team size ~${brief.estimatedTeamSize || 1}`);
    if (brief.riskFactors?.length) emitThinking(`Risks identified: ${brief.riskFactors.join(', ')}`);
    if (brief.constraints?.length) emitThinking(`Constraints: ${brief.constraints.join(', ')}`);
    emitThinking('Analysis complete. Moving to task decomposition...');
    return `Analyzed: "${brief.projectName}" — ${brief.projectType}, complexity ${brief.complexity || 3}, team of ${brief.estimatedTeamSize || 1}. Call plan_decompose next.`;
  } catch (e: any) { return `Analysis failed: ${e.message?.slice(0, 100)}`; }
}

async function toolPlanDecompose(args: any, companyId?: string): Promise<string> {
  const cid = companyId || 'default';
  const state = planState.get(cid);
  const brief = state?.brief;
  if (!brief) return 'No project brief found. Call plan_analyze first.';

  try {
    emitProgress('Designing', `Breaking down "${brief.projectName}"`, 1, 4);
    emitThinking('Breaking the project into individual work units...');
    emitThinking(`Reading brief: "${brief.projectName}" (${brief.projectType}, complexity ${brief.complexity || 3})`);
    
    // Enhanced prompt with project-specific context, dependencies, and context sharing
    const workflowType = brief.workflowType || 'hybrid';
    const systemPrompt = `You are a work architect specializing in ${brief.projectType} projects.

Break this project into DELIVERABLE-based work units. Each work unit = one discrete deliverable or module that gets submitted and paid on completion.

CRITICAL RULES:
1. **Deliverable-Based, Not Person-Based**: Create work units per deliverable batch or milestone.
2. **Group Similar Items**: If multiple similar deliverables exist, group them into one work unit with quantity > 1.
3. **Keep Complex Separate**: Complex or unique deliverables stay as individual work units.
4. **Respect Dependencies**: Don't group items with different dependencies.

For each work unit, write a COMPREHENSIVE spec (minimum 400 words per spec, 3-5 paragraphs) that includes ALL of these sections:

**SPEC REQUIREMENTS (each spec MUST have all of these):**
1. **Context & Purpose**: Why this deliverable exists, how it fits the project, who consumes the output. (1 paragraph)
2. **Detailed Requirements**: Exhaustive list of what must be produced. Be EXTREMELY specific — list exact pages, sections, components, word counts, dimensions. No vague language like "create content" — instead: "Write 5 landing page sections: hero (50 words), features (3 items × 80 words each), testimonials section layout, pricing table copy, CTA section (30 words)." (1-2 paragraphs)
3. **Technical Specifications**: Exact file formats, dimensions, tools, frameworks, naming conventions, folder structure. E.g. "Deliver as Figma file with auto-layout, 1440px desktop + 375px mobile breakpoints, using 8px grid." (1 paragraph)
4. **Quality Standards & What to Avoid**: Specific quality metrics. Reference brand guidelines, tone of voice, competitors to match or exceed. List 3-5 common mistakes to avoid. (1 paragraph)
5. **Acceptance Criteria**: 4-6 specific, measurable criteria. E.g. "All copy passes Hemingway Grade 8 readability", "Design passes WCAG AA contrast ratio", "Page loads in under 3s on 4G connection." (bullet list)

**WORKFLOW ORCHESTRATION — THIS IS CRITICAL:**
The project workflow type is "${workflowType}". You MUST set up dependencies and context sharing between work units:

- **dependencies**: Array of titles of other work units that MUST complete before this one can start. Think: "what deliverable does this task need as an input?"
  - If Task B needs the output of Task A, Task B depends on Task A.
  - If tasks can run in parallel, they have no dependencies on each other.
  
- **dependencyCondition**: What must happen to the dependency before this task unlocks:
  - "completed" = dependency must have an approved execution (verified output → next job)
  - "published" = dependency just needs to be published/active (concurrent start)
  - "failed" = this is a fallback task if the dependency fails

- **contextSharing**: How much context from dependency tasks should be shared with THIS task's contractor:
  - "full" = contractor sees full spec + approved deliverables + quality score from the dependency (use when contractor needs to BUILD ON or CONTINUE previous work)
  - "summary" = contractor sees task title + status (use when contractor needs AWARENESS but not details)
  - "none" = no sharing needed (independent tasks)

- **onFailure**: What happens if a dependency fails (only needed when dependencyCondition is "failed"):
  - "publish" = publish this task anyway (fallback/backup plan)
  - "cancel" = cancel this task too
  - "notify" = notify the company to decide

Think carefully: When does the contractor for Task B need to see the output from Task A? That's "full" sharing. When a marketing review needs to know that content was created but doesn't need the actual files? That's "summary".

Return JSON:
{
  "workUnits": [
    {
      "title": "Clear, specific deliverable name",
      "spec": "2-3 paragraph detailed specification...",
      "category": "Industry-appropriate category",
      "requiredSkills": ["skill1", "skill2"],
      "deliverableFormat": ["format1", "format2"],
      "acceptanceCriteria": [{"criterion": "...", "required": true}],
      "complexityScore": 1-5,
      "minTier": "novice|pro|elite",
      "deadlineHours": N,
      "revisionLimit": 2,
      "assignmentMode": "auto|manual",
      "quantity": N,
      "dependencies": [
        {"title": "title of dependency work unit", "condition": "completed|published|failed", "shareContext": "full|summary|none", "onFailure": "publish|cancel|notify (only if condition=failed)"}
      ],
      "inputsFrom": "Description of what this task receives from its dependencies",
      "outputsTo": "Description of what this task produces for downstream tasks"
    }
  ]
}

The quantity field indicates how many discrete deliverables this work unit covers (default: 1).`;

    const contextPrompt = `Project Brief:
${JSON.stringify(brief, null, 2)}

For this ${brief.projectType} project (workflow: ${workflowType}), consider:
- Industry standards for this project type
- Common deliverables expected in this industry
- **Dependencies between deliverables** — which tasks produce outputs consumed by others?
- **Context sharing** — which downstream contractors need to see upstream deliverables?
- Batch grouping opportunities
- Quality expectations based on quality bar: ${brief.qualityBar || 'professional'}
${brief.handoffPoints?.length ? `\nHandoff points identified in analysis:\n${brief.handoffPoints.map((h: string) => `- ${h}`).join('\n')}` : ''}
${brief.collaborationNeeds ? `\nCollaboration needs: ${brief.collaborationNeeds}` : ''}

Generate work units with clear dependency chains and context sharing. Every task that builds on another task's output MUST have dependencies and contextSharing set.`;

    const raw = await gpt52(systemPrompt, contextPrompt, 12288);
    const parsed = parseJSON(raw);
    const workUnits = parsed.workUnits || parsed.tasks || (Array.isArray(parsed) ? parsed : []);
    
    if (workUnits.length === 0) {
      emitThinking(`⚠ Parse result had no work units. Raw response starts with: ${raw.slice(0, 200)}`);
      return `Decomposition produced no tasks. The model returned: ${raw.slice(0, 150)}...`;
    }

    emitProgress('Designing', `Validating ${workUnits.length} work units`, 2, 4);
    // Validate and enhance work units
    const titleSet = new Set<string>();
    workUnits.forEach((wu: any, idx: number) => {
      emitProgress('Designing', `Validating "${wu.title}"`, idx + 1, workUnits.length);
      titleSet.add(wu.title);
      
      // Ensure spec is comprehensive (at least 200 chars)
      if (!wu.spec || wu.spec.length < 200) {
        emitThinking(`⚠ "${wu.title}" has a short spec, expanding...`);
        wu.spec = wu.spec || 'Detailed specification required.';
      }
      // Ensure acceptance criteria exist
      if (!wu.acceptanceCriteria || wu.acceptanceCriteria.length === 0) {
        wu.acceptanceCriteria = [{ criterion: 'Meets specification requirements', required: true }];
      }
      // Set defaults
      wu.quantity = wu.quantity || 1;
      wu.complexityScore = wu.complexityScore || brief.complexity || 3;
      wu.deadlineHours = wu.deadlineHours || 48;
      wu.revisionLimit = wu.revisionLimit || 2;
      wu.assignmentMode = wu.assignmentMode || 'auto';
      // Normalize dependencies: support both old format (string[]) and new format (object[])
      if (wu.dependencies?.length > 0) {
        wu.dependencies = wu.dependencies.map((dep: any) => {
          if (typeof dep === 'string') {
            // Old format: just a title string → upgrade to object
            return {
              title: dep,
              condition: wu.dependencyCondition || 'completed',
              shareContext: wu.contextSharing || 'summary',
              onFailure: wu.onFailure,
            };
          }
          // New format: already an object with title, condition, shareContext
          return {
            title: dep.title || dep,
            condition: dep.condition || 'completed',
            shareContext: dep.shareContext || 'summary',
            onFailure: dep.condition === 'failed' ? (dep.onFailure || 'notify') : undefined,
          };
        });
      }
      
      // Generate milestone templates for complex work units (complexity 4+ or deadline > 72h)
      if ((wu.complexityScore >= 4 || wu.deadlineHours > 72) && !wu.milestoneTemplates) {
        const milestoneCount = wu.complexityScore >= 5 ? 4 : 3;
        wu.milestoneTemplates = [];
        for (let i = 0; i < milestoneCount; i++) {
          const progress = (i + 1) / (milestoneCount + 1);
          wu.milestoneTemplates.push({
            orderIndex: i + 1,
            description: `Milestone ${i + 1}: ${progress < 0.33 ? 'Initial deliverable' : progress < 0.67 ? 'Progress review' : 'Final deliverable'}`,
            expectedCompletion: Math.round(progress * 100) / 100,
          });
        }
        emitThinking(`  Generated ${milestoneCount} milestone templates for "${wu.title}"`);
      }
    });

    // Validate dependency references exist (dependencies are now objects with .title)
    workUnits.forEach((wu: any) => {
      if (wu.dependencies?.length > 0) {
        wu.dependencies = wu.dependencies.filter((dep: any) => {
          const depTitle = typeof dep === 'string' ? dep : dep.title;
          if (!titleSet.has(depTitle)) {
            emitThinking(`  ⚠ "${wu.title}" references unknown dependency "${depTitle}" — removing`);
            return false;
          }
          return true;
        });
      }
    });

    // Build dependency graph summary
    const depChains: string[] = [];
    const tasksWithDeps = workUnits.filter((wu: any) => wu.dependencies?.length > 0);
    const parallelTasks = workUnits.filter((wu: any) => !wu.dependencies?.length);
    
    if (tasksWithDeps.length > 0) {
      emitThinking(`\nWorkflow orchestration:`);
      for (const wu of tasksWithDeps) {
        const depNames = wu.dependencies.map((d: any) => typeof d === 'string' ? d : d.title).join(' + ');
        const firstDep = wu.dependencies[0];
        const sharing = (firstDep?.shareContext || wu.contextSharing) === 'full' ? '(full context)' :
                        (firstDep?.shareContext || wu.contextSharing) === 'summary' ? '(summary)' : '';
        const chain = `  ${depNames} → ${wu.title} ${sharing}`;
        depChains.push(chain);
        emitThinking(chain);
      }
      if (parallelTasks.length > 0) {
        emitThinking(`  ${parallelTasks.length} task(s) can start immediately (no dependencies)`);
      }
    }

    planState.set(cid, { ...state, workUnits });
    emitProgress('Designing', `${workUnits.length} work units designed`, workUnits.length, workUnits.length);

    emitThinking(`\nIdentified ${workUnits.length} work units:`);
    workUnits.forEach((wu: any, i: number) => {
      const qty = wu.quantity > 1 ? ` (x${wu.quantity})` : '';
      const deps = wu.dependencies?.length > 0 ? ` [after: ${wu.dependencies.join(', ')}]` : '';
      emitThinking(`  ${i + 1}. ${wu.title}${qty} — ${wu.category}, ${wu.minTier} tier, ${wu.deadlineHours}h${deps}`);
    });
    emitThinking('Specs written. Moving to pricing...');

    const summary = workUnits.map((wu: any, i: number) => {
      const qty = wu.quantity > 1 ? ` (x${wu.quantity})` : '';
      const depTitles = (wu.dependencies || []).map((d: any) => typeof d === 'string' ? d : d.title);
      const deps = depTitles.length > 0 ? ` [depends on: ${depTitles.join(', ')}]` : '';
      return `${i + 1}. ${wu.title}${qty} — ${wu.category}, ${wu.minTier}, ${wu.deadlineHours}h${deps}`;
    }).join('\n');
    
    const orchestrationNote = depChains.length > 0
      ? `\n\nWorkflow:\n${depChains.join('\n')}`
      : '\nAll tasks can run in parallel.';
    return `${workUnits.length} work units:\n${summary}${orchestrationNote}\n\nCall plan_price next.`;
  } catch (e: any) { return `Decomposition failed: ${e.message?.slice(0, 100)}`; }
}

async function toolPlanPrice(args: any, companyId?: string): Promise<string> {
  const cid = companyId || 'default';
  const state = planState.get(cid);
  const workUnits = state?.workUnits;
  const brief = state?.brief;
  if (!workUnits?.length) return 'No work units found. Call plan_decompose first.';

  try {
    // Step 1: Enhanced web search for market rates (multiple queries for better coverage)
    emitProgress('Pricing', 'Researching market rates', 1, workUnits.length + 2);
    emitThinking(`Searching for current market rates...`);
    let marketData = '';
    const categories = [...new Set(workUnits.map((wu: any) => wu.category).filter(Boolean))];
    
    try {
      // Search for each unique category
      const searchQueries = categories.length > 0 
        ? categories.map(cat => `freelance ${cat} hourly rate 2025 market rate`)
        : [`freelance contractor rates 2025`, `freelance ${brief?.projectType || 'content'} rates 2025`];
      
      const searchResults = await Promise.all(
        searchQueries.slice(0, 3).map(query => 
          toolWebSearch({ query }).catch(() => '')
        )
      );
      marketData = searchResults.filter(Boolean).join('\n\n');
      emitThinking(`Found market data for ${categories.length} categories`);
    } catch { emitThinking('Market search unavailable, using built-in rates.'); }

    // Step 2: Enhanced pricing with project context
    emitProgress('Pricing', `Pricing ${workUnits.length} tasks`, 2, workUnits.length + 2);
    emitThinking(`Pricing ${workUnits.length} tasks with market data and project context...`);
    const taskList = workUnits.map((wu: any, i: number) => {
      const qty = wu.quantity > 1 ? ` (quantity: ${wu.quantity})` : '';
      return `${i + 1}. ${wu.title}${qty} — category: ${wu.category}, complexity: ${wu.complexityScore || 3}, tier: ${wu.minTier || 'novice'}, deadline: ${wu.deadlineHours || 48}h`;
    }).join('\n');
    
    const systemPrompt = `You are a pricing expert specializing in ${brief?.projectType || 'freelance'} projects.

Price each work unit in US cents using REALISTIC freelance market rates. Consider:

1. **Base Rate**: Use market rates from search results
2. **Complexity Adjustment**: Higher complexity = higher rate (complexity 1-2: base rate, 3: +20%, 4: +40%, 5: +60%)
3. **Quality Adjustment**: Higher quality bar = premium (basic: base, professional: +20%, premium: +30%)
4. **Timeline Adjustment**: Rush jobs (< 24h) = +25% premium, standard (24-72h) = base, flexible (>72h) = -10% discount
5. **Batch Discount**: For quantity > 1, apply 5-10% discount per unit (e.g., quantity 20 = 10% discount)
6. **Tier Adjustment**: Elite tier work commands 30-50% premium over novice tier
7. **Project Type Premium**: Some project types command higher rates (development, research)

Market Reference Data:
${marketData.slice(0, 2000)}

IMPORTANT PRICING GUIDELINES:
- UGC content: $50-$250 per post
- Writing: $0.10-$1.00 per word or $30-$100/hour
- Design: $50-$200/hour or $100-$500 per deliverable
- Development: $50-$150/hour
- Research: $40-$100/hour
- Project management: $30-$75/hour

Do NOT inflate prices. Be realistic and competitive.

Return JSON:
{
  "estimates": [
    {
      "title": "Work unit title",
      "priceInCents": N,
      "reasoning": "Detailed explanation: base rate $X/hr × Y hours, complexity adjustment +Z%, quality adjustment +W%, batch discount -V%, final price $N",
      "estimatedHours": N,
      "marketComparison": "How this compares to market rates (above/below/average)"
    }
  ]
}

Platform fee is 15% (already accounted for in pricing).`;

    const raw = await gpt52(systemPrompt, `Project Context:\nBudget: ${brief?.constraints?.find((c: string) => c.toLowerCase().includes('budget')) || 'flexible'}\nQuality Bar: ${brief?.qualityBar || 'professional'}\n\nWork Units to Price:\n${taskList}`, 6144);
    const estimates = parseJSON(raw).estimates || [];

    // Validate estimates match work units
    if (estimates.length !== workUnits.length) {
      emitThinking(`⚠ Warning: ${estimates.length} estimates for ${workUnits.length} work units. Aligning...`);
      // Pad or trim estimates to match
      while (estimates.length < workUnits.length) {
        estimates.push({ title: workUnits[estimates.length].title, priceInCents: 0, reasoning: 'Estimate pending', estimatedHours: 0 });
      }
      estimates.splice(workUnits.length);
    }

    // Apply batch quantity pricing adjustments
    estimates.forEach((e: any, i: number) => {
      const wu = workUnits[i];
      if (wu.quantity > 1 && e.priceInCents) {
        // Apply quantity discount: 5% per 5 units, max 15% discount
        const discountPercent = Math.min(15, Math.floor(wu.quantity / 5) * 5);
        const originalPrice = e.priceInCents;
        e.priceInCents = Math.round(e.priceInCents * (1 - discountPercent / 100));
        if (discountPercent > 0) {
          emitThinking(`  Applied ${discountPercent}% batch discount to "${e.title}" (quantity: ${wu.quantity})`);
        }
      }
    });

    // Sanity check: cap individual task prices at tier-appropriate maximums
    estimates.forEach((e: any, i: number) => {
      const tier = workUnits[i]?.minTier || 'novice';
      const complexity = workUnits[i]?.complexityScore || 3;
      // Higher complexity and tier = higher cap
      const baseMax = tier === 'elite' ? 2000000 : tier === 'pro' ? 1000000 : 500000; // $20K / $10K / $5K
      const complexityMultiplier = complexity >= 4 ? 1.5 : complexity >= 3 ? 1.2 : 1.0;
      const maxCents = Math.round(baseMax * complexityMultiplier);
      
      if (e.priceInCents > maxCents) {
        emitThinking(`  ⚠ ${e.title} was $${(e.priceInCents / 100).toFixed(0)}, capped to $${(maxCents / 100).toFixed(0)} (${tier} tier, complexity ${complexity})`);
        e.priceInCents = maxCents;
      }
    });

    const subtotal = estimates.reduce((s: number, e: any) => s + (e.priceInCents || 0), 0);
    const fees = Math.round(subtotal * 0.15);

    workUnits.forEach((wu: any, i: number) => { 
      if (estimates[i]) {
        wu.priceInCents = estimates[i].priceInCents;
        wu.estimatedHours = estimates[i].estimatedHours;
      }
    });
    planState.set(cid, { ...state, workUnits, estimates: { estimates, totalSubtotalCents: subtotal, platformFeesCents: fees, totalCents: subtotal + fees } });

    emitProgress('Pricing', `${estimates.length} tasks priced — $${((subtotal + fees) / 100).toFixed(0)} total`, estimates.length + 2, estimates.length + 2);
    emitThinking(`Pricing complete:`);
    estimates.forEach((e: any, i: number) => {
      const wu = workUnits[i];
      const qty = wu.quantity > 1 ? ` (x${wu.quantity})` : '';
      emitThinking(`  ${i + 1}. ${e.title}${qty} → $${((e.priceInCents || 0) / 100).toFixed(0)}${e.reasoning ? ` (${e.reasoning.slice(0, 60)}...)` : ''}`);
    });
    emitThinking(`Subtotal: $${(subtotal / 100).toFixed(0)} + $${(fees / 100).toFixed(0)} fees = $${((subtotal + fees) / 100).toFixed(0)} total`);
    emitThinking('Moving to legal & onboarding...');

    const summary = estimates.map((e: any, i: number) => {
      const wu = workUnits[i];
      const qty = wu.quantity > 1 ? ` (x${wu.quantity})` : '';
      return `${i + 1}. ${e.title}${qty} — $${((e.priceInCents || 0) / 100).toFixed(0)}`;
    }).join('\n');
    return `${estimates.length} tasks priced:\n${summary}\nTotal: $${((subtotal + fees) / 100).toFixed(0)} (incl. fees)\n\nCall plan_legal next.`;
  } catch (e: any) { return `Pricing failed: ${e.message?.slice(0, 100)}`; }
}

async function toolPlanLegal(args: any, companyId?: string): Promise<string> {
  const cid = companyId || 'default';
  const state = planState.get(cid);
  const workUnits = state?.workUnits;
  const brief = state?.brief;
  if (!workUnits?.length) return 'No work units found. Run the earlier stages first.';

  try {
    const allContracts: any[] = [];
    const allOnboarding: any[] = [];

    // Generate contracts + onboarding in BATCHED API calls — multiple WUs per call
    emitThinking(`Drafting contracts and onboarding for ${workUnits.length} work unit(s)...`);
    emitProgress('Legal', `Preparing ${workUnits.length} contracts`, 0, workUnits.length);
    const WUS_PER_CALL = 3; // Combine 3 work units per API call (3x fewer calls)
    
    for (let batchStart = 0; batchStart < workUnits.length; batchStart += WUS_PER_CALL) {
      const batch = workUnits.slice(batchStart, batchStart + WUS_PER_CALL);
      emitProgress('Legal', `Contracts: batch ${Math.floor(batchStart / WUS_PER_CALL) + 1}`, batchStart + 1, workUnits.length);
      emitThinking(`  Drafting batch: ${batch.map((w: any) => `"${w.title}"`).join(', ')}...`);

      const systemPrompt = `You are a legal specialist and onboarding designer for ${brief?.projectType || 'freelance'} projects.

Generate a contractor agreement AND onboarding page for EACH work unit listed below. Each contract must be tailored to its specific work unit.

CONTRACT REQUIREMENTS (per work unit) — minimum 600 words each:
1. SCOPE: Reference specific title, deliverables by name, exact deliverableFormat, and acceptance criteria verbatim.
2. COMPENSATION: State exact price from the work unit, payment timing (on approval), platform fee structure.
3. IP & OWNERSHIP: Work-for-hire clause, IP assignment, license grants, source file delivery requirements.
4. TIMELINE: Deadline in hours from assignment, milestone checkpoints if applicable, late delivery consequences.
5. REVISIONS: Specific revision limit from the work unit, what counts as a revision vs. a bug fix, response time.
6. CONFIDENTIALITY: NDA-level protection for project details, client identity, business strategies.
7. QUALITY STANDARDS: Reference the specific acceptance criteria. Define what "approved" means.
8. TERMINATION: Conditions for early termination by either party, partial payment policy.
9. DISPUTE RESOLUTION: Escalation process, mediation, governing law.
10. INDEPENDENT CONTRACTOR: Classification, tax responsibility, no employment relationship.
Write in plain English, enforceable language. Must be specific to THIS work unit — not generic.

ONBOARDING REQUIREMENTS (per work unit) — minimum 8 blocks, highly specific:
1. hero: Welcome heading referencing the exact task title + contractor role
2. text (Context): What this project is about, who the client is, why this deliverable matters (3+ sentences)
3. text (Your Task): Exactly what the contractor must deliver, in bullet points, with quantities and formats
4. text (Quality Standards): Specific quality bar — reference brand guidelines, examples, competitors to match
5. text (Technical Requirements): File formats, tools to use, naming conventions, folder structure
6. checklist (Before You Start): 6-8 items — "Read the full spec", "Review brand guidelines", "Check deadline", "Confirm tools available", "Review acceptance criteria", "Check revision policy"
7. text (Deliverable Format): Exact submission format, file naming, where to upload
8. cta: "Ready to Start?" with clear button text

Return JSON with an array — one entry per work unit, IN ORDER:
{
  "items": [
    {
      "title": "Work unit title",
      "contract": {
        "title": "Contractor Agreement: [Work Unit Title]",
        "content": "Full enforceable agreement (400+ words)"
      },
      "onboarding": {
        "blocks": [
          {"type": "hero", "content": {"heading": "Welcome to [Title]", "subheading": "..."}},
          {"type": "text", "content": {"heading": "Instructions", "body": "..."}},
          {"type": "text", "content": {"heading": "Deliverable Format", "body": "..."}},
          {"type": "text", "content": {"heading": "Quality Standards", "body": "..."}},
          {"type": "checklist", "content": {"heading": "Before You Start", "items": ["..."]}},
          {"type": "cta", "content": {"heading": "Ready to Start?", "body": "...", "buttonText": "Start Working"}}
        ]
      }
    }
  ]
}`;

      // Build batched context for all work units in this batch
      const batchContextParts = batch.map((wu: any, batchIdx: number) => {
        const i = batchStart + batchIdx;

        // Dependency context
        const depContext = (wu.dependencies?.length > 0) ? `Dependencies: ${wu.dependencies.map((dep: any) => {
          const depTitle = typeof dep === 'string' ? dep : dep.title;
          return `"${depTitle}" (${dep.condition || wu.dependencyCondition || 'completed'}, sharing: ${dep.shareContext || wu.contextSharing || 'summary'})`;
        }).join(', ')}${wu.inputsFrom ? `. Inputs: ${wu.inputsFrom}` : ''}` : '';

        // Downstream context
        const downstreamTasks = workUnits.filter((w: any) => {
          const deps = (w.dependencies || []).map((d: any) => typeof d === 'string' ? d : d.title);
          return deps.includes(wu.title);
        });
        const downstreamContext = downstreamTasks.length > 0 ? `Downstream: ${downstreamTasks.map((d: any) => `"${d.title}"`).join(', ')} depend on this. Deliverables will be shared.` : '';

        return `--- WORK UNIT ${i + 1}: ${wu.title} ---
Spec: ${(wu.spec || '').slice(0, 800)}
Category: ${wu.category} | Skills: ${(wu.requiredSkills || []).join(', ')}
Format: ${(wu.deliverableFormat || []).join(', ')} | Criteria: ${JSON.stringify(wu.acceptanceCriteria || [])}
Price: $${((wu.priceInCents || 0) / 100).toFixed(0)} | Deadline: ${wu.deadlineHours || 48}h | Revisions: ${wu.revisionLimit || 2} | Qty: ${wu.quantity || 1}
${depContext}${downstreamContext ? '\n' + downstreamContext : ''}`;
      }).join('\n\n');

      const contextPrompt = `Project: "${brief?.projectName || 'Project'}" (${brief?.projectType || 'content'}, quality: ${brief?.qualityBar || 'professional'}, workflow: ${brief?.workflowType || 'hybrid'})

Generate contracts + onboarding for these ${batch.length} work unit(s). Return the "items" array with one entry per work unit IN ORDER.

${batchContextParts}`;

      try {
        const raw = await gpt52(systemPrompt, contextPrompt, 16384);
        const parsed = parseJSON(raw);
        const items = parsed.items || (Array.isArray(parsed) ? parsed : [parsed]);

        // Process each item in the batch result
        for (let batchIdx = 0; batchIdx < batch.length; batchIdx++) {
          const wu = batch[batchIdx];
          const i = batchStart + batchIdx;
          const item = items[batchIdx];

          if (item?.contract?.content) {
            // Validate contract content length
            if (item.contract.content.length < 300) {
              item.contract.content += '\n\nAdditional terms: This agreement covers all deliverables specified in the work unit specification. The contractor agrees to deliver work meeting the acceptance criteria. Payment will be processed upon approval of deliverables.';
            }

            // Validate onboarding blocks
            if (!item.onboarding?.blocks || item.onboarding.blocks.length < 3) {
              item.onboarding = item.onboarding || { blocks: [] };
              if (item.onboarding.blocks.length === 0) {
                item.onboarding.blocks = [
                  { type: 'hero', content: { heading: `Welcome to ${wu.title}`, subheading: 'Please review the requirements below' } },
                  { type: 'text', content: { heading: 'Instructions', body: wu.spec?.slice(0, 500) || 'Please refer to the work unit specification for detailed instructions.' } },
                  { type: 'checklist', content: { heading: 'Before You Start', items: ['Review the specification', 'Understand the acceptance criteria', 'Confirm deliverable format'] } },
                  { type: 'cta', content: { heading: 'Ready?', body: 'Click below to start working', buttonText: 'Start Working' } }
                ];
              }
            }

            emitThinking(`  ✓ "${wu.title}" contract (${item.contract.content.length} chars) + ${item.onboarding?.blocks?.length || 0} blocks`);
            allContracts.push({ ...item.contract, taskIndex: i, taskTitle: wu.title });
            allOnboarding.push({ ...item.onboarding, taskIndex: i, taskTitle: wu.title });
          } else {
            // Item missing or malformed — use inline fallback
            emitThinking(`  ⚠ "${wu.title}" contract not in response, generating inline`);
            allContracts.push({
              title: `Contractor Agreement: ${wu.title}`,
              content: `This agreement covers the work unit "${wu.title}". Payment: $${((wu.priceInCents || 0) / 100).toFixed(0)}. Deadline: ${wu.deadlineHours || 48} hours. Revisions: ${wu.revisionLimit || 2}. Deliverables must meet acceptance criteria.`,
              taskIndex: i, taskTitle: wu.title,
            });
            allOnboarding.push({
              blocks: [
                { type: 'hero', content: { heading: `Welcome to ${wu.title}`, subheading: 'Please review the requirements' } },
                { type: 'text', content: { heading: 'Instructions', body: wu.spec?.slice(0, 500) || 'Please refer to the work unit specification.' } },
                { type: 'cta', content: { heading: 'Ready?', body: 'Click below to start', buttonText: 'Start Working' } }
              ],
              taskIndex: i, taskTitle: wu.title,
            });
          }
        }
      } catch (e: any) {
        emitThinking(`  ⚠ Batch call failed: ${e.message?.slice(0, 60)}, generating inline contracts`);
        // Generate minimal inline contracts for the entire batch
        for (let batchIdx = 0; batchIdx < batch.length; batchIdx++) {
          const wu = batch[batchIdx];
          const i = batchStart + batchIdx;
          allContracts.push({
            title: `Contractor Agreement: ${wu.title}`,
            content: `This agreement covers "${wu.title}". Payment: $${((wu.priceInCents || 0) / 100).toFixed(0)}. Deadline: ${wu.deadlineHours || 48}h. Revisions: ${wu.revisionLimit || 2}.`,
            taskIndex: i, taskTitle: wu.title,
          });
          allOnboarding.push({
            blocks: [
              { type: 'hero', content: { heading: `Welcome to ${wu.title}`, subheading: 'Review requirements below' } },
              { type: 'text', content: { heading: 'Instructions', body: wu.spec?.slice(0, 500) || 'See work unit specification.' } },
              { type: 'cta', content: { heading: 'Ready?', body: 'Click below to start', buttonText: 'Start Working' } }
            ],
            taskIndex: i, taskTitle: wu.title,
          });
        }
      }
    }

    planState.set(cid, { ...state, legal: { contracts: allContracts, onboarding: allOnboarding } });

    emitThinking(`\nLegal package complete: ${allContracts.length} contracts, ${allOnboarding.length} onboarding pages.`);
    emitThinking('Planning complete. Ready for execution.');

    const summary = allContracts.map((c, i) => `${i + 1}. "${c.title}" for ${c.taskTitle}`).join('\n');
    return `${allContracts.length} individual contracts + ${allOnboarding.length} onboarding pages ready:\n${summary}\n\nPlan complete. Ask the user to confirm before creating.`;
  } catch (e: any) { return `Legal planning failed: ${e.message?.slice(0, 100)}`; }
}

async function toolPlanExecute(companyId: string): Promise<string> {
  const state = planState.get(companyId);
  if (!state?.workUnits?.length) return 'No plan to execute. Run plan_analyze through plan_legal first.';

  const results: string[] = [];
  const createdWUIds: string[] = [];
  const wuTitleToId: Map<string, string> = new Map();

  try {
    // Resolve dependencies: sort work units by dependencies (dependencies first)
    const sortedWUs = [...state.workUnits];
    const resolved = new Set<string>();
    const sorted: any[] = [];
    
    // Topological sort — deps can be strings or objects {title, condition, shareContext}
    let maxIterations = sortedWUs.length * 2;
    while (sorted.length < sortedWUs.length && maxIterations-- > 0) {
      for (const wu of sortedWUs) {
        if (resolved.has(wu.title)) continue;
        const rawDeps: any[] = wu.dependencies || [];
        const depTitles = rawDeps.map((d: any) => typeof d === 'string' ? d : d.title);
        if (depTitles.length === 0 || depTitles.every((t: string) => resolved.has(t))) {
          sorted.push(wu);
          resolved.add(wu.title);
        }
      }
    }
    
    // If sorting failed, use original order
    const workUnitsToCreate = sorted.length === sortedWUs.length ? sorted : sortedWUs;
    
    if (sorted.length !== sortedWUs.length) {
      emitThinking('⚠ Dependency resolution incomplete, using original order');
    } else if (workUnitsToCreate.some(wu => (wu.dependencies || []).length > 0)) {
      emitThinking(`✓ Resolved dependencies, creating work units in order`);
    }

    // 1. Create all work units with milestone templates
    const totalSteps = workUnitsToCreate.length * 3; // work units + contracts + onboarding
    emitThinking(`Creating ${workUnitsToCreate.length} work units...`);
    for (let i = 0; i < workUnitsToCreate.length; i++) {
      const wu = workUnitsToCreate[i];
      const originalIndex = state.workUnits.findIndex((w: any) => w.title === wu.title);
      emitProgress('Executing', `Creating "${wu.title}"`, i + 1, totalSteps);
      emitThinking(`  Creating "${wu.title}" (${i + 1}/${workUnitsToCreate.length})...`);

      try {
        // Prepare milestone templates if they exist
        const milestoneData = wu.milestoneTemplates?.length > 0 ? {
          create: wu.milestoneTemplates.map((mt: any, idx: number) => ({
            orderIndex: mt.orderIndex || idx + 1,
            description: mt.description || `Milestone ${idx + 1}`,
            expectedCompletion: mt.expectedCompletion || (idx + 1) / (wu.milestoneTemplates.length + 1),
          }))
        } : undefined;

        const created = await db.workUnit.create({
          data: {
            companyId,
            title: wu.title,
            spec: wu.spec || '',
            category: wu.category || 'general',
            priceInCents: wu.priceInCents || 3000,
            deadlineHours: wu.deadlineHours || 48,
            requiredSkills: wu.requiredSkills || [],
            acceptanceCriteria: wu.acceptanceCriteria || [{ criterion: 'Meets specification', required: true }],
            deliverableFormat: wu.deliverableFormat || [],
            requiredDocuments: [],
            minTier: wu.minTier || 'novice',
            complexityScore: wu.complexityScore || 1,
            revisionLimit: wu.revisionLimit || 2,
            status: 'draft',
            assignmentMode: wu.assignmentMode || 'auto',
            deliverableCount: wu.deliverableCount || wu.quantity || 1,
            hasExamples: false,
            exampleUrls: [],
            preferredHistory: 0,
            maxRevisionTendency: 0.3,
            ...(milestoneData ? { milestoneTemplates: milestoneData } : {}),
          },
        });

        // Create escrow
        const feePercent = PRICING_CONFIG.platformFees.novice;
        const feeAmount = Math.round(created.priceInCents * feePercent);
        await db.escrow.create({
          data: {
            workUnitId: created.id,
            companyId,
            amountInCents: created.priceInCents,
            platformFeeInCents: feeAmount,
            netAmountInCents: created.priceInCents - feeAmount,
            status: 'pending',
          },
        });

        createdWUIds.push(created.id);
        wuTitleToId.set(wu.title, created.id);

        // Wire up publish conditions from dependencies (verified output → next job)
        const deps: any[] = wu.dependencies || [];
        if (deps.length > 0) {
          const resolvedDeps: Array<{ workUnitId: string; condition: string; shareContext: string; onFailure?: string }> = [];
          
          for (const dep of deps) {
            // Dependencies can be objects {title, condition, shareContext} or strings (backward compat)
            const depTitle = typeof dep === 'string' ? dep : dep.title;
            const depId = wuTitleToId.get(depTitle);
            if (!depId) continue;
            
            // Use per-dependency condition/sharing from decomposition
            const condition = (typeof dep === 'object' ? dep.condition : null) || wu.dependencyCondition || 'completed';
            const shareContext = (typeof dep === 'object' ? dep.shareContext : null) || wu.contextSharing || 'summary';
            const depEntry: any = {
              workUnitId: depId,
              condition,
              shareContext,
            };
            if (condition === 'failed') {
              depEntry.onFailure = (typeof dep === 'object' ? dep.onFailure : null) || wu.onFailure || 'notify';
            }
            resolvedDeps.push(depEntry);
          }

          if (resolvedDeps.length > 0) {
            try {
              await (db.workUnit as any).update({
                where: { id: created.id },
                data: {
                  publishConditions: {
                    logic: 'AND',
                    dependencies: resolvedDeps,
                  },
                },
              });
              const conditions = resolvedDeps.map(d => d.condition).filter((v, i, a) => a.indexOf(v) === i);
              const sharingTypes = resolvedDeps.map(d => d.shareContext).filter((v, i, a) => a.indexOf(v) === i);
              emitThinking(`  → ${resolvedDeps.length} dep(s): ${conditions.join('/')} condition, ${sharingTypes.join('/')} sharing`);
            } catch (depErr: any) {
              emitThinking(`  ⚠ Failed to set dependencies: ${depErr?.message?.slice(0, 40)}`);
            }
          }
        }

        const milestoneInfo = wu.milestoneTemplates?.length > 0 ? ` (${wu.milestoneTemplates.length} milestones)` : '';
        const depTitles = deps.map((d: any) => typeof d === 'string' ? d : d.title);
        const depInfo = depTitles.length > 0 ? ` [after: ${depTitles.join(', ')}]` : '';
        results.push(`✓ "${wu.title}" ($${(created.priceInCents / 100).toFixed(0)})${milestoneInfo}${depInfo}`);
        emitThinking(`  ✓ Created ${created.id.slice(0, 8)}${milestoneInfo}`);
      } catch (e: any) {
        const errorMsg = e.message?.slice(0, 50) || 'Unknown error';
        results.push(`✗ "${wu.title}": ${errorMsg}`);
        emitThinking(`  ✗ Failed: ${errorMsg}`);
        // Continue with other work units even if one fails
      }
    }

    // 2. Create contracts per work unit
    const contracts = state.legal?.contracts || [];
    if (contracts.length > 0) {
      emitThinking(`\nCreating ${contracts.length} contracts...`);
      for (let i = 0; i < contracts.length; i++) {
        const c = contracts[i];
        const wuId = createdWUIds[c.taskIndex] || createdWUIds[0];
        emitProgress('Executing', `Contract: "${c.taskTitle || c.title}"`, workUnitsToCreate.length + i + 1, totalSteps);
        emitThinking(`  Creating contract "${c.title}" for WU ${(c.taskIndex || 0) + 1}...`);

        try {
          const slug = `wu-${wuId.slice(0, 8)}-${c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}-${Date.now().toString(36)}`;
          await db.legalAgreement.create({
            data: { title: c.title, slug, content: c.content || '', version: 1, requiresResign: true, status: 'draft' },
          });
          results.push(`✓ Contract: "${c.title}"`);
          emitThinking(`  ✓ Contract created`);
        } catch (e: any) {
          results.push(`✗ Contract "${c.title}": ${e.message?.slice(0, 50)}`);
        }
      }
    }

    // 3. Set onboarding per work unit
    const onboarding = state.legal?.onboarding || [];
    if (onboarding.length > 0) {
      emitProgress('Executing', `Setting up ${onboarding.length} onboarding pages`, totalSteps - 1, totalSteps);
      emitThinking(`\nSetting up ${onboarding.length} onboarding pages...`);
      const company = await db.companyProfile.findUnique({ where: { id: companyId } });
      if (company) {
        const existing = (typeof company.address === 'object' && company.address) || {};
        const pages = (existing as any).onboardingPages || {};

        for (let i = 0; i < onboarding.length; i++) {
          const ob = onboarding[i];
          const wuId = createdWUIds[ob.taskIndex] || createdWUIds[i];
          if (wuId && ob.blocks) {
            pages[wuId] = { accentColor: '#a78bfa', blocks: ob.blocks.map((b: any, j: number) => ({ id: `plan-${i}-${j}`, ...b })) };
            emitThinking(`  ✓ Onboarding for WU ${(ob.taskIndex || i) + 1}`);
          }
        }

        await db.companyProfile.update({ where: { id: companyId }, data: { address: { ...existing, onboardingPages: pages } as any } });
        results.push(`✓ ${onboarding.length} onboarding pages set`);
      }
    }

    // Auto-create workflow group for the project
    let groupName = '';
    if (createdWUIds.length >= 2) {
      try {
        groupName = state.brief?.projectName || 'Untitled Project';
        const group = await (db as any).workflowGroup.create({
          data: {
            companyId,
            name: groupName,
            description: state.brief?.goal || null,
            color: '#6366f1',
          },
        });
        await (db.workUnit as any).updateMany({
          where: { id: { in: createdWUIds } },
          data: { workflowGroupId: group.id },
        });
        results.push(`✓ Workflow space: "${groupName}" (${createdWUIds.length} tasks) — visible at /dashboard/workunits/workflow`);
        emitThinking(`\n✓ Created workflow space "${groupName}"`);
      } catch (groupErr: any) {
        emitThinking(`⚠ Failed to create workflow group: ${groupErr?.message?.slice(0, 40)}`);
      }
    }

    // Build workflow visualization
    const workflowLines: string[] = [];
    const immediateStarts: string[] = [];
    const chainedTasks: string[] = [];
    
    for (const wu of workUnitsToCreate) {
      const deps: any[] = wu.dependencies || [];
      if (deps.length === 0) {
        immediateStarts.push(wu.title);
      } else {
        const depTitles = deps.map((d: any) => typeof d === 'string' ? d : d.title);
        const firstDep = deps[0];
        const sharing = (typeof firstDep === 'object' ? firstDep.shareContext : wu.contextSharing) === 'full' ? 'full context' :
                        (typeof firstDep === 'object' ? firstDep.shareContext : wu.contextSharing) === 'summary' ? 'summary' : '';
        const condition = (typeof firstDep === 'object' ? firstDep.condition : wu.dependencyCondition) === 'completed' ? 'verified' :
                          (typeof firstDep === 'object' ? firstDep.condition : wu.dependencyCondition) === 'published' ? 'published' : 'failed';
        chainedTasks.push(`  ${depTitles.join(' + ')} → [${condition}] → ${wu.title}${sharing ? ` (${sharing})` : ''}`);
      }
    }

    if (immediateStarts.length > 0 || chainedTasks.length > 0) {
      workflowLines.push('\n📊 Workflow:');
      if (immediateStarts.length > 0) {
        workflowLines.push(`  Start immediately: ${immediateStarts.join(', ')}`);
      }
      if (chainedTasks.length > 0) {
        workflowLines.push('  Dependency chains:');
        workflowLines.push(...chainedTasks);
      }
      const fullSharingCount = workUnitsToCreate.filter((wu: any) => wu.contextSharing === 'full').length;
      const summarySharingCount = workUnitsToCreate.filter((wu: any) => wu.contextSharing === 'summary').length;
      if (fullSharingCount > 0 || summarySharingCount > 0) {
        workflowLines.push(`  Context sharing: ${fullSharingCount} full, ${summarySharingCount} summary`);
      }
    }

    // Clear plan state only if all work units were created successfully
    const failedCount = results.filter(r => r.startsWith('✗')).length;
    if (failedCount === 0) {
      planState.delete(companyId);
    } else {
      emitThinking(`⚠ ${failedCount} items failed — plan state preserved for retry`);
    }

    emitProgress('Executing', `Done — ${createdWUIds.length} work units created`, totalSteps, totalSteps);
    emitThinking(`\nExecution complete.`);
    const workflowSection = workflowLines.length > 0 ? `\n${workflowLines.join('\n')}` : '';
    return `Plan executed:\n${results.join('\n')}${workflowSection}\n\n${createdWUIds.length} work units created (draft). Fund escrow and activate to publish. Tasks with dependencies will auto-publish when their conditions are met.\n\nOpen the **Workflow** page to see the visual diagram and adjust task connections.`;
  } catch (e: any) {
    return `Execution failed: ${e.message?.slice(0, 200)}`;
  }
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
        headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': braveKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);
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
      const serperController = new AbortController();
      const serperTimeout = setTimeout(() => serperController.abort(), 8000);
      const res = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serperKey}&num=5`, { signal: serperController.signal });
      clearTimeout(serperTimeout);
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

// ============================================================
// Company Panel Tool Implementations
// ============================================================

async function toolMarkNotificationRead(args: any, companyId: string): Promise<string> {
  const company = await db.companyProfile.findUnique({ where: { id: companyId }, include: { user: true } });
  if (!company) return 'Company not found.';
  await db.notification.updateMany({
    where: { id: args.notificationId, userId: company.user.clerkId, userType: 'company' },
    data: { readAt: new Date() },
  });
  return 'Notification marked as read.';
}

async function toolMarkAllNotificationsRead(companyId: string): Promise<string> {
  const company = await db.companyProfile.findUnique({ where: { id: companyId }, include: { user: true } });
  if (!company) return 'Company not found.';
  const result = await db.notification.updateMany({
    where: { userId: company.user.clerkId, userType: 'company', readAt: null },
    data: { readAt: new Date() },
  });
  return `Marked ${result.count} notification(s) as read.`;
}

async function toolExportWorkUnits(companyId: string): Promise<string> {
  const json = await panelService.exportWorkUnitsJson(companyId);
  const parsed = JSON.parse(json);
  const summary = `Exported ${parsed.length} work unit(s). Data returned in tool result.`;
  // Return summary + first 500 chars of JSON as preview
  return `${summary}\n\nPreview (first 500 chars):\n${json.slice(0, 500)}...`;
}

async function toolExportExecutions(companyId: string): Promise<string> {
  const json = await panelService.exportExecutionsJson(companyId);
  const parsed = JSON.parse(json);
  const summary = `Exported ${parsed.length} execution(s). Data returned in tool result.`;
  return `${summary}\n\nPreview (first 500 chars):\n${json.slice(0, 500)}...`;
}

async function toolBulkUpdateWorkUnits(args: any, companyId: string): Promise<string> {
  const { workUnitIds, ...patch } = args;
  if (!workUnitIds || !Array.isArray(workUnitIds) || workUnitIds.length === 0) {
    return 'workUnitIds array is required';
  }
  const count = await panelService.bulkUpdateWorkUnits(companyId, workUnitIds, patch);
  return `Updated ${count} work unit(s).`;
}

async function toolBulkPublishWorkUnits(args: any, companyId: string): Promise<string> {
  const { workUnitIds } = args;
  if (!workUnitIds || !Array.isArray(workUnitIds) || workUnitIds.length === 0) {
    return 'workUnitIds array is required';
  }
  const result = await panelService.bulkPublishWorkUnits(companyId, workUnitIds);
  const successCount = result.success.length;
  const failedCount = result.failed.length;
  if (failedCount === 0) {
    return `Published ${successCount} work unit(s).`;
  }
  return `Published ${successCount} work unit(s). ${failedCount} failed: ${result.failed.map(f => f.error).join(', ')}`;
}

async function toolBulkAssignContractor(args: any, companyId: string): Promise<string> {
  const { workUnitIds, studentId } = args;
  if (!workUnitIds || !Array.isArray(workUnitIds) || workUnitIds.length === 0) {
    return 'workUnitIds array is required';
  }
  if (!studentId) return 'studentId is required';
  const result = await panelService.bulkAssignContractor(companyId, workUnitIds, studentId);
  const successCount = result.success.length;
  const failedCount = result.failed.length;
  if (failedCount === 0) {
    return `Assigned contractor to ${successCount} work unit(s).`;
  }
  return `Assigned contractor to ${successCount} work unit(s). ${failedCount} failed: ${result.failed.map(f => f.error).join(', ')}`;
}

async function toolArchiveWorkUnit(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({ where: { id: args.workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';
  await panelService.archiveWorkUnit(companyId, args.workUnitId);
  await panelService.appendActivityLog(companyId, {
    action: 'archive_work_unit',
    entityType: 'work_unit',
    entityId: args.workUnitId,
  });
  return `Archived "${wu.title}".`;
}

async function toolRestoreWorkUnit(args: any, companyId: string): Promise<string> {
  const wu = await db.workUnit.findFirst({ where: { id: args.workUnitId, companyId } });
  if (!wu) return 'Work unit not found.';
  await panelService.restoreWorkUnit(companyId, args.workUnitId);
  await panelService.appendActivityLog(companyId, {
    action: 'restore_work_unit',
    entityType: 'work_unit',
    entityId: args.workUnitId,
  });
  return `Restored "${wu.title}".`;
}

async function toolListArchivedWorkUnits(companyId: string): Promise<string> {
  const archived = await panelService.listArchivedWorkUnits(companyId);
  if (archived.length === 0) return 'No archived work units.';
  return archived.map((wu: any) => {
    const archivedAt = (wu as any).archivedAt;
    return `"${wu.title}" — archived ${archivedAt ? new Date(archivedAt).toLocaleDateString() : 'unknown'} [${wu.id.slice(0, 8)}]`;
  }).join('\n');
}

async function toolSaveWorkUnitTemplate(args: any, companyId: string): Promise<string> {
  try {
    const templateId = await panelService.createTemplateFromWorkUnit(companyId, args.name, args.workUnitId);
    await panelService.appendActivityLog(companyId, {
      action: 'create_template',
      entityType: 'work_unit_template',
      entityId: templateId,
    });
    return `Saved template "${args.name}" (${templateId.slice(0, 8)}).`;
  } catch (err: any) {
    return `Failed to save template: ${err.message}`;
  }
}

async function toolListWorkUnitTemplates(companyId: string): Promise<string> {
  const templates = await panelService.listTemplates(companyId);
  if (templates.length === 0) return 'No templates saved.';
  return templates.map((t: any) => `"${t.name}" — created ${new Date(t.createdAt).toLocaleDateString()} [${t.id.slice(0, 8)}]`).join('\n');
}

async function toolCreateWorkUnitFromTemplate(args: any, companyId: string): Promise<string> {
  try {
    const workUnitId = await panelService.createDraftFromTemplate(companyId, args.templateId, args.title);
    await panelService.appendActivityLog(companyId, {
      action: 'create_work_unit_from_template',
      entityType: 'work_unit',
      entityId: workUnitId,
      metadata: { templateId: args.templateId },
    });
    return `Created draft work unit from template (${workUnitId.slice(0, 8)}).`;
  } catch (err: any) {
    return `Failed to create work unit: ${err.message}`;
  }
}

async function toolSetContractorPreference(args: any, companyId: string): Promise<string> {
  const { studentId, type, reason } = args;
  if (type !== 'blacklist' && type !== 'whitelist') {
    return 'type must be "blacklist" or "whitelist"';
  }
  await panelService.setContractorPreference(companyId, studentId, type, reason);
  await panelService.appendActivityLog(companyId, {
    action: `set_contractor_${type}`,
    entityType: 'contractor_preference',
    metadata: { studentId, reason },
  });
  return `Set contractor ${type} for student ${studentId.slice(0, 8)}.`;
}

async function toolListContractorPreferences(companyId: string): Promise<string> {
  const prefs = await panelService.listContractorPreferences(companyId);
  if (prefs.length === 0) return 'No contractor preferences set.';
  return prefs.map((p: any) => `${p.type}: ${p.student.name} (${p.student.email})${p.reason ? ` — ${p.reason}` : ''} [${p.student.id.slice(0, 8)}]`).join('\n');
}

async function toolGetContractorHistory(args: any, companyId: string): Promise<string> {
  const history = await panelService.getContractorHistory(companyId, args.studentId);
  if (history.length === 0) return 'No history with this contractor.';
  return history.map((e: any) => {
    const status = e.status;
    const title = (e as any).workUnit?.title || 'Unknown';
    const price = `$${((e as any).workUnit?.priceInCents || 0) / 100}`;
    return `${status}: "${title}" — ${price} [${e.id.slice(0, 8)}]`;
  }).join('\n');
}

async function toolGetActivityLog(args: any, companyId: string): Promise<string> {
  const limit = args.limit || 50;
  const logs = await panelService.getActivityLog(companyId, limit);
  if (logs.length === 0) return 'No activity logged.';
  return logs.map((log: any) => {
    const date = new Date(log.createdAt).toLocaleString();
    const entity = log.entityType && log.entityId ? `${log.entityType}:${log.entityId.slice(0, 8)}` : '';
    return `${date} — ${log.action}${entity ? ` (${entity})` : ''}`;
  }).join('\n');
}

// ============================================================
// EXECUTION MESSAGING
// ============================================================

async function toolSendMessageToContractor(args: any, companyId: string, userId: string): Promise<string> {
  if (!args.executionId) return 'executionId is required. Use list_all_executions to find the right execution.';
  if (!args.content?.trim()) return 'Message content is required.';

  const execution = await db.execution.findFirst({
    where: { id: args.executionId, workUnit: { companyId } },
    include: {
      workUnit: { include: { company: { select: { companyName: true } } } },
      student: { select: { clerkId: true, name: true } },
    },
  });
  if (!execution) return 'Execution not found or does not belong to your company.';

  // Create message
  const message = await (db as any).executionMessage.create({
    data: {
      executionId: args.executionId,
      senderId: userId,
      senderType: 'company',
      senderName: execution.workUnit.company.companyName,
      messageType: 'text',
      content: args.content.trim(),
    },
  });

  // Notify the contractor
  await db.notification.create({
    data: {
      userId: execution.student.clerkId,
      userType: 'student',
      type: 'execution_message',
      title: `Message from ${execution.workUnit.company.companyName}`,
      body: args.content.slice(0, 150),
      channels: ['in_app', 'email'],
      data: { executionId: args.executionId, messageId: message.id, workUnitTitle: execution.workUnit.title },
    },
  });

  // Push via WebSocket
  try {
    const { getIO } = await import('../websocket/index.js');
    const io = getIO();
    if (io) {
      const marketplace = io.of('/marketplace');
      const payload = { executionId: args.executionId, message };
      marketplace.to(`student:${execution.student.clerkId}`).emit('execution:message:new', payload);
      marketplace.to(`execution:${args.executionId}`).emit('execution:message:new', payload);
    }
  } catch {}

  return `Message sent to ${execution.student.name} on "${execution.workUnit.title}": "${args.content.slice(0, 100)}${args.content.length > 100 ? '...' : ''}"`;
}

async function toolGetExecutionMessages(args: any, companyId: string): Promise<string> {
  if (!args.executionId) return 'executionId is required.';

  const execution = await db.execution.findFirst({
    where: { id: args.executionId, workUnit: { companyId } },
    select: { id: true, workUnit: { select: { title: true } }, student: { select: { name: true } } },
  });
  if (!execution) return 'Execution not found or does not belong to your company.';

  const messages = await (db as any).executionMessage.findMany({
    where: { executionId: args.executionId },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  if (messages.length === 0) return `No messages yet in thread for "${execution.workUnit.title}" with ${execution.student.name}.`;

  const unread = messages.filter((m: any) => m.senderType === 'student' && !m.readAt).length;
  const header = `Message thread for "${execution.workUnit.title}" with ${execution.student.name} (${messages.length} messages, ${unread} unread):`;

  const lines = messages.map((m: any) => {
    const time = new Date(m.createdAt).toLocaleString();
    const tag = m.senderType === 'company' ? 'YOU' : m.senderType === 'ai' ? 'AI' : m.senderName || 'Contractor';
    const read = m.senderType !== 'company' && m.readAt ? ' ✓read' : '';
    return `[${time}] ${tag}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}${read}`;
  }).join('\n');

  return `${header}\n${lines}`;
}
