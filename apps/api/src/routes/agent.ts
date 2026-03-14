/**
 * Agent Route — conversational AI for the business panel.
 * Single streaming endpoint that handles all business operations through chat.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import { db } from '@figwork/db';
import { getOpenAIClient } from '@figwork/ai';
import { verifyClerkAuth } from '../lib/clerk.js';
import { TOOL_DEFINITIONS, executeTool, setStreamWriter, setProgressWriter, selectToolsForMessage, DIRECT_READ_COMMANDS } from '../lib/agent-tools.js';

function buildSystemPrompt(company: any, context: any): string {
  const name = company.companyName || 'this company';
  return `You are the Figwork assistant for ${name}. You switch between modes based on what the user needs.

STATE: ${context.activeWorkUnits} active, ${context.inProgressExecutions} in progress, ${context.pendingReviews} awaiting review, $${(context.monthlySpend / 100).toFixed(2)} spent this month.

Use tools. Confirm before creating/spending. After actions, state what happened + suggest next step. Use **bold** for key terms, be concise.

MODES:

1. SCOPE DESIGNER — creating work/hiring.
Ask the goal first, then decompose into deliverables. Write detailed specs (2+ paragraphs each). Work units = deliverables, not people. After confirmation: create tasks, set criteria, add milestones, estimate cost. For 2+ tasks: call setup_dependency_chain + create_workflow_group.
Planning chain: plan_analyze → plan_decompose → plan_price → plan_legal → plan_execute (run ALL without stopping). After plan_execute: call list_work_units, setup_dependency_chain, create_workflow_group.

2. OPERATIONS — monitoring/reviews/status.
Use get_monitoring_summary, list_all_executions, review_submission, request_pow_check.

3. CONTRACTS — legal/NDAs.
Use create_contract (include workUnitId), activate_contract. Write enforceable language.

4. ONBOARDING — contractor experience.
ALWAYS call set_onboarding with blocks array: hero, text, checklist, cta, image, video, file, divider. Never just describe — call the tool.

5. FINANCIAL — budget/cost/invoices.
Use get_billing, calculate_pricing (auto web-searches market rates), estimate_cost.

6. WORKFLOW ORCHESTRATOR — dependencies/scheduling/chaining.
STEPS:
1. list_workflow_groups — check existing groups
2. list_work_units — see all tasks with IDs, deps, contractors
3. MODIFY existing workflow: use setup_dependency_chain or set_publish_schedule. Do NOT create new group.
4. NEW workflow only: setup_dependency_chain + create_workflow_group (with WU IDs, never empty).

RULES:

WORKFLOW GROUPS:
- ALWAYS call list_workflow_groups before creating. Never duplicate. Never create empty groups.
- To modify existing tasks: work IN PLACE. Do not create new groups.
- create_workflow_group MUST include workUnitIds.

DEPENDENCIES:
- setup_dependency_chain: pass ordered IDs for sequential chains (ONE call).
- set_publish_schedule: for individual task scheduling or complex non-linear deps.
- Conditions: "completed" (verified output → next job), "published" (concurrent), "failed" (with onFailure: publish/cancel/notify).
- Sharing: "full" (spec + deliverables), "summary" (title + status), "none".
- AND/OR logic: AND = all deps met, OR = any one.

IDS: Short hex IDs (e.g. "d9e7ec83") and titles both resolve. Prefer short IDs from previous tool results.

CONTEXT: Messages with [CONTEXT: Currently viewing "..." (ID: ...)] — all operations apply to THAT work unit only.

BEHAVIOR:
- After completing the request, STOP. Don't chain extra actions unless asked.
- NEVER delete or archive unless the user EXPLICITLY says "delete" or "archive". Activate ≠ delete. "All that matters" ≠ delete.
- NEVER reverse an action you just performed. If you just restored a task, do NOT archive it again. If you just created something, do NOT delete it.
- When the user's message is short or a single word (e.g. "yes", "homepage", "first one", "do it", "sure", "all"), it is ALWAYS a direct reply to YOUR previous question or options. Re-read your last message, find the question you asked, and map their answer to one of the options. NEVER interpret a short reply as a brand new request. Examples: if you asked "link to homepage or about page?" and user says "homepage", that means "use the homepage URL." If you asked "price or create task?" and user says "price", that means "price it."
- Ask ONE clarifying question at a time, not a list.
- web_search: synthesize results naturally, don't dump raw data.
- Uploaded files: read thoroughly, reference specific details.
- If a tool returns an error, read the error message carefully and either retry with corrected params or explain the issue to the user.
- NEVER call a tool that doesn't exist. If you're unsure, call list_work_units or get_monitoring_summary first.
- When creating multiple related tasks, ALWAYS call them sequentially (create A, then B, then C) — never assume IDs.
- When setting up dependencies, ALWAYS call list_work_units first to get the real IDs, then call setup_dependency_chain with those IDs.
- For destructive actions (delete, archive, cancel), ALWAYS confirm with the user first by stating exactly what will happen.`;
}

async function getCompanyContext(companyId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [activeWU, inProgressExec, pendingReview, monthlySpend] = await Promise.all([
    (db.workUnit as any).count({ where: { companyId, status: { in: ['active', 'in_progress'] }, archivedAt: null } }),
    db.execution.count({ where: { workUnit: { companyId }, status: { in: ['assigned', 'clocked_in'] } } }),
    db.execution.count({ where: { workUnit: { companyId }, status: 'submitted' } }),
    db.escrow.aggregate({
      where: { companyId, status: 'funded', fundedAt: { gte: monthStart } },
      _sum: { amountInCents: true },
    }),
  ]);

  return {
    activeWorkUnits: activeWU,
    inProgressExecutions: inProgressExec,
    pendingReviews: pendingReview,
    monthlySpend: monthlySpend._sum.amountInCents || 0,
  };
}

function getToolStatusLabel(toolName: string, args: any): string {
  switch (toolName) {
    case 'web_search': return `Searching "${(args.query || '').slice(0, 60)}"`;
    case 'create_work_unit': return `Creating task "${(args.title || '').slice(0, 40)}"`;
    case 'update_work_unit': return 'Updating task';
    case 'list_work_units': return 'Looking up your tasks';
    case 'get_work_unit': return 'Reading task details';
    case 'list_candidates': return 'Finding matching contractors';
    case 'assign_student': return 'Assigning contractor';
    case 'review_submission': return 'Reviewing submission';
    case 'fund_escrow': return 'Processing escrow payment';
    case 'get_billing': return 'Checking financials';
    case 'estimate_cost': return 'Calculating cost estimate';
    case 'calculate_pricing': return 'Researching market rates';
    case 'draft_sow': return 'Drafting statement of work';
    case 'draft_nda': return 'Drafting NDA';
    case 'draft_msa': return 'Drafting master service agreement';
    case 'create_contract': return 'Creating contract';
    case 'list_contracts': return 'Loading contracts';
    case 'activate_contract': return 'Activating contract';
    case 'set_onboarding': return 'Designing onboarding page';
    case 'get_onboarding': return 'Loading onboarding page';
    case 'get_monitoring_summary': return 'Checking operations status';
    case 'list_all_executions': return 'Loading all executions';
    case 'get_pow_logs': return 'Checking proof-of-work logs';
    case 'request_pow_check': return 'Requesting check-in';
    case 'get_company_profile': return 'Reading company profile';
    case 'update_company_profile': return 'Updating company profile';
    case 'plan_analyze': return 'Analyzing project';
    case 'plan_decompose': return 'Designing work units';
    case 'plan_price': return 'Calculating pricing';
    case 'plan_legal': return 'Drafting contracts & onboarding';
    case 'plan_execute': return 'Executing plan (creating everything)';
    case 'get_execution_status': return 'Checking execution';
    case 'set_publish_schedule': return 'Setting publish schedule';
    case 'setup_dependency_chain': return 'Chaining task dependencies';
    case 'get_publish_status': return 'Checking publish status';
    case 'create_workflow_group': return `Creating workflow space "${(args.name || '').slice(0, 30)}"`;
    case 'update_workflow_group': return 'Updating workflow space';
    case 'assign_to_workflow_group': return 'Organizing tasks into space';
    case 'list_workflow_groups': return 'Loading workflow spaces';
    case 'delete_workflow_group': return 'Removing workflow space';
    case 'publish_work_unit': return 'Publishing task';
    case 'mark_notification_read': return 'Marking notification as read';
    case 'mark_all_notifications_read': return 'Marking all notifications as read';
    case 'export_work_units': return 'Exporting work units';
    case 'export_executions': return 'Exporting executions';
    case 'bulk_update_work_units': return `Updating ${(args.workUnitIds || []).length} tasks`;
    case 'bulk_publish_work_units': return `Publishing ${(args.workUnitIds || []).length} tasks`;
    case 'bulk_assign_contractor': return `Assigning contractor to ${(args.workUnitIds || []).length} tasks`;
    case 'archive_work_unit': return 'Archiving task';
    case 'restore_work_unit': return 'Restoring archived task';
    case 'list_archived_work_units': return 'Loading archived tasks';
    case 'save_work_unit_template': return `Saving template "${(args.name || '').slice(0, 30)}"`;
    case 'list_work_unit_templates': return 'Loading templates';
    case 'create_work_unit_from_template': return 'Creating task from template';
    case 'set_contractor_preference': return `Setting contractor ${args.type || 'preference'}`;
    case 'list_contractor_preferences': return 'Loading contractor preferences';
    case 'get_contractor_history': return 'Loading contractor history';
    case 'get_activity_log': return 'Loading activity log';
    default: return `Running ${toolName.replace(/_/g, ' ')}`;
  }
}

export default async function agentRoutes(fastify: FastifyInstance) {
  // Register multipart for file uploads
  await fastify.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB max

  // POST /chat — streaming agent conversation
  fastify.post('/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user?.companyProfile) {
      return reply.status(403).send({ error: 'Company profile required' });
    }

    const company = user.companyProfile;
    const { conversationId, message, images } = request.body as {
      conversationId?: string;
      message: string;
      images?: string[]; // base64 data URLs for vision
    };

    if (!message?.trim()) {
      return reply.status(400).send({ error: 'Message is required' });
    }

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await db.agentConversation.findFirst({
        where: { id: conversationId, companyId: company.id },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
      });
    }

    if (!conversation) {
      conversation = await db.agentConversation.create({
        data: {
          companyId: company.id,
          title: message.slice(0, 100),
        },
        include: { messages: [] as any },
      });
    }

    // Save user message
    await db.agentMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message,
      },
    });

    // ═══════════════════════════════════════════════════════════════
    // SHORT-CIRCUIT: Direct execution for simple read commands
    // Skips full agent loop — executes tool directly, streams result
    // ═══════════════════════════════════════════════════════════════
    const normalizedMsg = message.trim();
    const matchedCmd = DIRECT_READ_COMMANDS.find(cmd =>
      cmd.patterns.some(p => p.test(normalizedMsg))
    );
    if (matchedCmd) {
      reply.hijack();
      let scKeepalive: ReturnType<typeof setInterval> | null = null;
      try {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
          'Access-Control-Allow-Credentials': 'true',
          'X-Conversation-Id': conversation.id,
        });
        scKeepalive = setInterval(() => {
          try { reply.raw.write(': keepalive\n\n'); } catch { if (scKeepalive) clearInterval(scKeepalive); }
        }, 15000);

        // Execute tool directly — no AI needed
        const toolResult = await executeTool(matchedCmd.toolName, matchedCmd.args(normalizedMsg), company.id, user.id);
        const formatted = matchedCmd.format(toolResult);

        // Stream the formatted result
        reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: formatted })}\n\n`);

        // Save assistant response
        await db.agentMessage.create({
          data: { conversationId: conversation.id, role: 'assistant', content: formatted },
        });

        // Generate context-aware suggestions using cheap model
        try {
          const openai = getOpenAIClient();
          const suggRes = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Based on this data, suggest 3-4 short next actions the user might want to take. Return ONLY a JSON array of strings. Keep each under 30 chars.' },
              { role: 'user', content: `User asked: "${message}"\nResult:\n${toolResult.slice(0, 800)}` },
            ],
            max_completion_tokens: 120,
            temperature: 0.4,
          });
          const raw = suggRes.choices[0]?.message?.content || '[]';
          const match = raw.match(/\[[\s\S]*\]/);
          if (match) {
            const suggestions = JSON.parse(match[0]);
            if (Array.isArray(suggestions)) {
              reply.raw.write(`data: ${JSON.stringify({ type: 'suggestions', items: suggestions.slice(0, 4) })}\n\n`);
            }
          }
        } catch {}

        if (scKeepalive) clearInterval(scKeepalive);
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', conversationId: conversation.id })}\n\n`);
        reply.raw.end();
      } catch (err: any) {
        if (scKeepalive) clearInterval(scKeepalive);
        try {
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err?.message?.slice(0, 200) || 'Error' })}\n\n`);
          reply.raw.write(`data: ${JSON.stringify({ type: 'done', conversationId: conversation.id })}\n\n`);
        } catch {}
        try { reply.raw.end(); } catch {}
      }
      return;
    }

    // Build message history for OpenAI
    const context = await getCompanyContext(company.id);
    const systemPrompt = buildSystemPrompt(company, context);

    const openaiMessages: any[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history — must maintain valid tool_calls→tool pairing
    // OpenAI requires EVERY tool_call_id to have a matching tool response
    // Keep last 40 messages for maximum context — more history = better accuracy
    const HISTORY_WINDOW = 40;
    const history = conversation.messages || [];
    const recentHistory = history.length > HISTORY_WINDOW ? history.slice(-HISTORY_WINDOW) : history;
    
    if (history.length > HISTORY_WINDOW) {
      // Compress older messages using GPT for a high-quality summary
      const olderMessages = history.slice(0, history.length - HISTORY_WINDOW);
      
      // Build a condensed transcript of older messages for GPT to summarize
      const transcriptParts: string[] = [];
      for (const msg of olderMessages) {
        if (msg.role === 'user' && msg.content) {
          transcriptParts.push(`USER: ${(msg.content as string).slice(0, 200)}`);
        } else if (msg.role === 'assistant' && msg.content) {
          transcriptParts.push(`ASSISTANT: ${(msg.content as string).slice(0, 300)}`);
        } else if (msg.role === 'tool') {
          const results = msg.toolResults as any;
          if (results?.content) {
            const toolContent = typeof results.content === 'string' ? results.content : JSON.stringify(results.content);
            transcriptParts.push(`TOOL_RESULT: ${toolContent.slice(0, 150)}`);
          }
        }
      }
      const transcript = transcriptParts.join('\n').slice(0, 4000); // Cap at 4K chars for the compression call

      let contextSummary: string;
      try {
        const summaryRes = await getOpenAIClient().chat.completions.create({
          model: 'gpt-4o-mini', // Cheap + fast for compression
          messages: [
            { role: 'system', content: `Compress this conversation into a concise context summary (max 500 words). Include:
1. What the user's project/goal is
2. All work units created (with short IDs if visible)
3. All contracts, onboarding pages, or workflows set up
4. Key decisions made (prices, deadlines, URLs, preferences)
5. The last thing discussed / any pending question
6. Important IDs, names, URLs mentioned
Format as bullet points. Be specific — include numbers, IDs, URLs. Skip pleasantries.` },
            { role: 'user', content: transcript },
          ],
          max_completion_tokens: 600,
          temperature: 0,
        });
        const compressed = summaryRes.choices[0]?.message?.content || '';
        contextSummary = compressed
          ? `[CONTEXT from ${olderMessages.length} earlier messages]\n${compressed}\n\n[Recent messages follow — continue from here.]`
          : `[${olderMessages.length} earlier messages omitted. Continue from recent context.]`;
      } catch {
        // Fallback: naive extraction if GPT compression fails
        const userMsgs = olderMessages.filter(m => m.role === 'user' && m.content).map(m => (m.content as string).slice(0, 100));
        const toolResults = olderMessages.filter(m => m.role === 'tool' && (m.toolResults as any)?.content).map(m => {
          const c = (m.toolResults as any).content;
          return typeof c === 'string' ? c.slice(0, 80) : '';
        }).filter(Boolean);
        contextSummary = `[CONTEXT from ${olderMessages.length} earlier messages]\nUser topics: ${userMsgs.slice(-5).join(' | ')}\nActions: ${toolResults.slice(-8).join(', ')}\n\n[Continue from recent messages.]`;
      }
      
      openaiMessages.push({ role: 'user', content: contextSummary });
      openaiMessages.push({ role: 'assistant', content: 'Understood — I have the full context. Continuing.' });
    }
    
    for (let i = 0; i < recentHistory.length; i++) {
      const msg = recentHistory[i];
      if (msg.role === 'user') {
        // Cap very long user messages (e.g. pasted documents) to avoid context overflow
        const content = (msg.content || '').length > 6000
          ? (msg.content as string).slice(0, 6000) + '\n[...content truncated in history]'
          : msg.content || '';
        openaiMessages.push({ role: 'user', content });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && Array.isArray(msg.toolCalls) && (msg.toolCalls as any[]).length > 0) {
          const toolCalls = msg.toolCalls as any[];
          const requiredIds = new Set(toolCalls.map((tc: any) => tc.id));
          // Build a map of tool call IDs to their tool names for smart compression
          const toolCallNameMap = new Map<string, string>();
          for (const tc of toolCalls) {
            if (tc.id && tc.function?.name) toolCallNameMap.set(tc.id, tc.function.name);
          }

          // Peek ahead and collect tool responses — compress based on tool type
          const toolResponses: any[] = [];
          let j = i + 1;
          while (j < recentHistory.length && recentHistory[j].role === 'tool') {
            const results = recentHistory[j].toolResults as any;
            if (results?.toolCallId && requiredIds.has(results.toolCallId)) {
              let content = results.content || '';
              // Read-only tools (list/get/export): compress more aggressively in history
              // Write tools (create/update/set): keep more context as the details matter
              const toolName = toolCallNameMap.get(results.toolCallId) || '';
              const isReadOnly = /^(list_|get_|export_)/.test(toolName);
              const maxChars = isReadOnly ? 3000 : 4000;
              if (content.length > maxChars) {
                content = content.slice(0, maxChars) + '\n[...result truncated]';
              }
              toolResponses.push({
                role: 'tool',
                tool_call_id: results.toolCallId,
                content,
              });
              requiredIds.delete(results.toolCallId);
            }
            j++;
          }

          // Only include this assistant+tool group if ALL tool_calls have responses
          if (requiredIds.size === 0) {
            openaiMessages.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });
            openaiMessages.push(...toolResponses);
          } else {
            // Incomplete tool responses — skip this group, add content-only version
            if (msg.content) {
              openaiMessages.push({ role: 'assistant', content: msg.content });
            }
          }

          i = j - 1; // Skip past tool messages we already processed
        } else {
          openaiMessages.push({ role: 'assistant', content: msg.content || '' });
        }
      }
      // Skip orphaned tool messages (handled above)
    }

    // Add current message — with images if present (GPT-4o vision)
    if (images && images.length > 0) {
      const contentParts: any[] = [{ type: 'text', text: message }];
      for (const img of images) {
        contentParts.push({ type: 'image_url', image_url: { url: img, detail: 'auto' } });
      }
      openaiMessages.push({ role: 'user', content: contentParts });
    } else {
      openaiMessages.push({ role: 'user', content: message });
    }

    // Tell Fastify we're taking over the response — prevents Fastify from trying to
    // finalize/end the response when the async handler completes, which would cause
    // ERR_INCOMPLETE_CHUNKED_ENCODING on long-running SSE streams
    reply.hijack();

    // CRITICAL: After hijack(), Fastify no longer catches errors for us.
    // Any unhandled error will crash the process. Wrap EVERYTHING in try/catch.
    let keepalive: ReturnType<typeof setInterval> | null = null;
    try {

    // Set up SSE streaming with CORS headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
      'Access-Control-Allow-Credentials': 'true',
      'X-Conversation-Id': conversation.id,
    });

    const openai = getOpenAIClient();
    let fullContent = '';
    let toolCallsAccumulated: any[] = [];

    // Set stream writer so planning tools can emit thinking text
    setStreamWriter((text: string) => {
      try { reply.raw.write(`data: ${JSON.stringify({ type: 'thinking', content: text })}\n\n`); } catch {}
    });
    // Set progress writer so planning tools can emit granular progress
    setProgressWriter((data) => {
      try { reply.raw.write(`data: ${JSON.stringify({ type: 'planning_progress', ...data })}\n\n`); } catch {}
    });
    const toolCallCounts = new Map<string, number>(); // exact call dedup
    const toolNameCounts = new Map<string, number>(); // per-tool-name counter (regardless of args)
    const createdTitles = new Set<string>(); // Track created work unit titles to prevent duplicates
    let totalToolCalls = 0;
    let consecutiveIdenticalLoops = 0; // tracks if the model is stuck in a loop
    let lastLoopToolNames = ''; // fingerprint of last loop's tool calls
    const MAX_TOTAL_TOOL_CALLS = 80; // Safety cap — high enough for complex multi-step projects
    const MAX_IDENTICAL_CALLS = 2; // Stop if the same exact call repeats this many times
    const MAX_READ_TOOL_CALLS = 2; // Read-only tools (get_*, list_*) max calls per name
    const MAX_WRITE_TOOL_CALLS = 5; // Write tools max calls per name (e.g. create_work_unit × 5 for multi-task)

    // Keepalive: send a comment every 15s to prevent proxy/browser timeouts during long tool calls
    keepalive = setInterval(() => {
      try { reply.raw.write(': keepalive\n\n'); } catch { if (keepalive) clearInterval(keepalive); }
    }, 15000);

    try {
      // Agent loop — runs until the agent is done or safety cap hit
      let loopMessages = [...openaiMessages];
      let maxLoops = 20; // Balanced: enough for complex workflows, stops runaway loops

      // Dynamic tool selection — only send relevant tools based on user message + recent context
      const recentHistoryForSelection = (conversation.messages || []).slice(-6).map((m: any) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
      }));
      let selectedTools = await selectToolsForMessage(message, recentHistoryForSelection);

      while (maxLoops-- > 0) {
        const stream = await openai.chat.completions.create({
          model: 'gpt-5.2',
          messages: loopMessages,
          tools: selectedTools,
          stream: true,
          temperature: 0, // Zero temperature = maximum accuracy, fully deterministic
          max_completion_tokens: 16384, // Maximum output tokens for complete responses
        });

        let currentContent = '';
        let currentToolCalls: any[] = [];
        let finishReason = '';

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          finishReason = chunk.choices[0]?.finish_reason || finishReason;

          // Stream text content
          if (delta?.content) {
            currentContent += delta.content;
            reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: delta.content })}\n\n`);
          }

          // Accumulate tool calls
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined) {
                while (currentToolCalls.length <= tc.index) {
                  currentToolCalls.push({ id: '', function: { name: '', arguments: '' } });
                }
                if (tc.id) currentToolCalls[tc.index].id = tc.id;
                if (tc.function?.name) currentToolCalls[tc.index].function.name += tc.function.name;
                if (tc.function?.arguments) currentToolCalls[tc.index].function.arguments += tc.function.arguments;
              }
            }
          }
        }

        // If no tool calls, we're done
        if (finishReason !== 'tool_calls' || currentToolCalls.length === 0) {
          fullContent += currentContent;
          break;
        }

        // Execute tool calls
        fullContent += currentContent;

        // Add assistant message with tool calls to loop
        loopMessages.push({
          role: 'assistant',
          content: currentContent || null,
          tool_calls: currentToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });

        for (const tc of currentToolCalls) {
          const toolName = tc.function.name;
          let toolArgs: any = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch (parseErr) {
            // Arguments were truncated or malformed — give the agent precise recovery instructions
            const rawArgs = tc.function.arguments || '';
            const result = `Error: JSON parse failed for ${toolName}. Raw args (first 200 chars): "${rawArgs.slice(0, 200)}". The arguments were malformed or truncated. Retry the call with valid JSON arguments. If passing arrays of IDs, ensure all quotes and brackets are closed.`;
            console.error(`[Agent] JSON parse failed for ${toolName}: ${rawArgs.slice(0, 200)}`);
            reply.raw.write(`data: ${JSON.stringify({ type: 'tool', name: toolName, status: 'done', result })}\n\n`);
            await db.agentMessage.create({ data: { conversationId: conversation.id, role: 'tool', toolResults: { toolCallId: tc.id, content: result } } });
            loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
            toolCallsAccumulated.push({ id: tc.id, name: toolName, args: {}, result });
            continue;
          }

          // Dedup: block by title for create_work_unit, by exact args for others
          totalToolCalls++;
          let result: string;

          // Title-based dedup for create_work_unit and create_contract
          if ((toolName === 'create_work_unit' || toolName === 'create_contract') && toolArgs.title) {
            const titleKey = `${toolName}:${toolArgs.title.toLowerCase().trim()}`;
            if (createdTitles.has(titleKey)) {
              result = `"${toolArgs.title}" already created. Skip.`;
              reply.raw.write(`data: ${JSON.stringify({ type: 'tool', name: toolName, status: 'done', result })}\n\n`);
              await db.agentMessage.create({ data: { conversationId: conversation.id, role: 'tool', toolResults: { toolCallId: tc.id, content: result } } });
              loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
              toolCallsAccumulated.push({ id: tc.id, name: toolName, args: toolArgs, result });
              continue;
            }
            createdTitles.add(titleKey);
          }

          const callKey = `${toolName}:${JSON.stringify(toolArgs)}`;
          const repeatCount = toolCallCounts.get(callKey) || 0;
          toolCallCounts.set(callKey, repeatCount + 1);

          // Per-tool-name counter (regardless of args)
          const nameCount = toolNameCounts.get(toolName) || 0;
          toolNameCounts.set(toolName, nameCount + 1);
          const isReadTool2 = /^(get_|list_|export_)/.test(toolName);
          const maxForThisTool = isReadTool2 ? MAX_READ_TOOL_CALLS : MAX_WRITE_TOOL_CALLS;

          if (totalToolCalls > MAX_TOTAL_TOOL_CALLS) {
            result = `Safety limit reached (${totalToolCalls} calls). Stop calling tools. Summarize what you've done and ask the user what to do next.`;
          } else if (repeatCount >= MAX_IDENTICAL_CALLS) {
            result = `This exact call was already made ${repeatCount} times with the same result. Do NOT call it again. Use the data you already have.`;
          } else if (nameCount >= maxForThisTool) {
            result = `${toolName} already called ${nameCount} times this turn. Use the data you already have. Do NOT call this tool again.`;
          } else {

            // Send human-readable status indicator (ChatGPT-style)
            const statusLabel = getToolStatusLabel(toolName, toolArgs);
            reply.raw.write(`data: ${JSON.stringify({ type: 'tool_status', label: statusLabel, name: toolName, phase: 'start' })}\n\n`);

            result = await executeTool(toolName, toolArgs, company.id, user.id);

            reply.raw.write(`data: ${JSON.stringify({ type: 'tool_status', label: statusLabel, name: toolName, phase: 'done' })}\n\n`);
          }
          reply.raw.write(`data: ${JSON.stringify({ type: 'tool', name: toolName, status: 'done', result })}\n\n`);

          // Save tool result
          await db.agentMessage.create({
            data: {
              conversationId: conversation.id,
              role: 'tool',
              toolResults: { toolCallId: tc.id, content: result },
            },
          });

          // Add to loop messages — cap tool results to prevent context overflow
          // Read-only tools: 4000 chars (full data for accuracy). Write tools: 2000 chars.
          const isReadTool = /^(list_|get_|export_|search)/.test(toolName);
          const maxResult = isReadTool ? 4000 : 2000;
          const loopResult = result.length > maxResult ? result.slice(0, maxResult) + '\n[...truncated]' : result;
          loopMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: loopResult,
          });

          toolCallsAccumulated.push({ id: tc.id, name: toolName, args: toolArgs, result: loopResult });
        }

        // Save assistant message with tool calls
        await db.agentMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: currentContent || null,
            toolCalls: currentToolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          },
        });

        // Detect consecutive identical loops — if the model called the same tools twice in a row, it's stuck
        const thisLoopToolNames = currentToolCalls.map(tc => tc.function.name).sort().join(',');
        if (thisLoopToolNames === lastLoopToolNames && thisLoopToolNames.length > 0) {
          consecutiveIdenticalLoops++;
          if (consecutiveIdenticalLoops >= 2) {
            // Force-inject a stop instruction into the messages
            loopMessages.push({
              role: 'user',
              content: '[SYSTEM: You are stuck in a loop calling the same tools repeatedly. STOP calling tools now. Summarize what you have done and respond to the user.]',
            });
            console.warn(`[Agent] Forced loop break — "${thisLoopToolNames}" repeated ${consecutiveIdenticalLoops + 1} times`);
          }
        } else {
          consecutiveIdenticalLoops = 0;
        }
        lastLoopToolNames = thisLoopToolNames;

        // Re-expand tools ONLY if the model explicitly mentioned needing a tool from another group
        // Check if any tool result contains "Unknown tool" or the model's text mentions a tool name not in current set
        const selectedNames = new Set(selectedTools.map(t => t.function.name));
        const mentionedTools = (currentContent || '').match(/\b(create_contract|set_onboarding|plan_analyze|setup_dependency_chain|draft_sow|draft_nda|calculate_pricing)\b/g);
        const needsExpansion = mentionedTools?.some(t => !selectedNames.has(t));
        if (needsExpansion) {
          const expandedTools = await selectToolsForMessage(
            currentContent || '',
            loopMessages.slice(-4).map((m: any) => ({
              role: m.role,
              content: m.content,
              toolCalls: m.tool_calls,
            })),
          );
          if (expandedTools.length > selectedTools.length) {
            selectedTools = expandedTools;
          }
        }

        // Continue the loop — GPT will process tool results and generate response
      }

      // If loop exhausted without a final text response, send a summary
      if (maxLoops <= 0 && toolCallsAccumulated.length > 0) {
        const summary = `Completed ${toolCallsAccumulated.length} operations. The workflow has been updated — check the Workflow page to see the changes.`;
        fullContent += summary;
        reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: summary })}\n\n`);
      }

      // Save final assistant message
      if (fullContent) {
        await db.agentMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: fullContent,
          },
        });
      }

      // Update conversation title from first message
      if (!conversation.title || conversation.title === message.slice(0, 100)) {
        await db.agentConversation.update({
          where: { id: conversation.id },
          data: { title: message.slice(0, 80) },
        });
      }

      // Generate context-aware suggestions using cheap model (10x cheaper than gpt-5.2)
      try {
        const suggestionPrompt = `Based on this conversation, suggest 3-4 short next actions the user might want to take. Return ONLY a JSON array of strings, no explanation. Example: ["Publish this task","Create a contract","Set up onboarding"]. Keep each under 30 chars.`;
        const suggestionRes = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            ...loopMessages.slice(-4),
            { role: 'user', content: suggestionPrompt },
          ],
          max_completion_tokens: 120,
          temperature: 0.4,
        });
        const raw = suggestionRes.choices[0]?.message?.content || '[]';
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          const suggestions = JSON.parse(match[0]);
          if (Array.isArray(suggestions)) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'suggestions', items: suggestions.slice(0, 4) })}\n\n`);
          }
        }
      } catch {}

      if (keepalive) clearInterval(keepalive);
      setStreamWriter(null);
      setProgressWriter(null);
      reply.raw.write(`data: ${JSON.stringify({ type: 'done', conversationId: conversation.id })}\n\n`);
      reply.raw.end();
    } catch (err: any) {
      if (keepalive) clearInterval(keepalive);
      setStreamWriter(null);
      setProgressWriter(null);
      console.error('[Agent] Error:', err?.message || err);
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err?.message?.slice(0, 200) || 'Agent error' })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', conversationId: conversation.id })}\n\n`);
      } catch {} // Stream may already be closed
      try { reply.raw.end(); } catch {}
    }

    // Outer catch-all: after hijack(), unhandled errors crash the process
    } catch (fatalErr: any) {
      if (keepalive) clearInterval(keepalive);
      setStreamWriter(null);
      setProgressWriter(null);
      console.error('[Agent] Fatal error after hijack:', fatalErr?.message || fatalErr);
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'Internal server error' })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', conversationId: conversation?.id || '' })}\n\n`);
      } catch {}
      try { reply.raw.end(); } catch {}
    }
  });

  // GET /conversations — list conversations for this company
  fastify.get('/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user?.companyProfile) {
      return reply.status(403).send({ error: 'Company profile required' });
    }

    const conversations = await db.agentConversation.findMany({
      where: { companyId: user.companyProfile.id },
      select: { id: true, title: true, updatedAt: true, workUnitId: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });

    return reply.send({ conversations });
  });

  // GET /conversations/:id — get full conversation with messages
  fastify.get<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user?.companyProfile) {
      return reply.status(403).send({ error: 'Company profile required' });
    }

    const conversation = await db.agentConversation.findFirst({
      where: { id: request.params.id, companyId: user.companyProfile.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    return reply.send(conversation);
  });

  // DELETE /conversations/:id
  fastify.delete<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user?.companyProfile) {
      return reply.status(403).send({ error: 'Company profile required' });
    }

    await db.agentConversation.deleteMany({
      where: { id: request.params.id, companyId: user.companyProfile.id },
    });

    return reply.send({ success: true });
  });

  // POST /extract-file — extract text from PDF/DOCX/images for the chat agent
  fastify.post('/extract-file', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    try {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const buffer = await data.toBuffer();
      const filename = data.filename || 'unknown';
      const mimetype = data.mimetype || '';

      let text = '';

      if (mimetype === 'application/pdf' || filename.endsWith('.pdf')) {
        try {
          const pdfParse = (await import('pdf-parse')).default;
          const result = await pdfParse(buffer);
          text = result.text?.slice(0, 15000) || '[PDF contained no extractable text]';
          if (result.info?.Title) text = `Title: ${result.info.Title}\n\n${text}`;
        } catch {
          text = '[PDF text extraction failed — the file may be image-based or encrypted]';
        }
      } else if (mimetype.includes('wordprocessing') || filename.endsWith('.docx')) {
        // DOCX is a zip — extract document.xml and strip tags
        try {
          const AdmZip = (await import('adm-zip')).default;
          const zip = new AdmZip(buffer);
          const docXml = zip.getEntry('word/document.xml');
          if (docXml) {
            const xml = docXml.getData().toString('utf-8');
            text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 15000);
          }
        } catch {
          text = '[DOCX text extraction failed]';
        }
      } else if (mimetype.startsWith('text/') || filename.match(/\.(txt|csv|md|json|js|ts|py)$/)) {
        text = buffer.toString('utf-8').slice(0, 15000);
      } else {
        text = `[Binary file: ${filename}, ${(buffer.length / 1024).toFixed(0)}KB, type: ${mimetype}]`;
      }

      return reply.send({ text, filename, size: buffer.length });
    } catch (err: any) {
      return reply.status(500).send({ error: 'File processing failed', details: err?.message });
    }
  });

  // POST /upload-onboarding-file — upload a file for onboarding page blocks (uses Cloudinary)
  fastify.post('/upload-onboarding-file', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    try {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file' });

      const buffer = await data.toBuffer();
      const filename = data.filename || 'file';
      const mimetype = data.mimetype || '';
      const isImage = mimetype.startsWith('image/');

      // Upload to Cloudinary
      try {
        const { cloudinary } = await import('../lib/cloudinary.js');
        const resourceType = isImage ? 'image' : 'raw';
        const publicId = `onboarding/${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

        const result = await new Promise<any>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { public_id: publicId, resource_type: resourceType },
            (err: any, res: any) => { if (err) reject(err); else resolve(res); }
          );
          stream.end(buffer);
        });

        return reply.send({
          url: result.secure_url,
          filename,
          size: buffer.length,
          mimetype,
          publicId: result.public_id,
        });
      } catch (cloudErr: any) {
        // Fallback to base64 if Cloudinary is not configured
        if (buffer.length > 2 * 1024 * 1024) {
          return reply.status(400).send({ error: 'File too large. Configure Cloudinary for large file uploads.' });
        }
        const base64 = buffer.toString('base64');
        return reply.send({
          url: `data:${mimetype};base64,${base64}`,
          filename,
          size: buffer.length,
          mimetype,
        });
      }
    } catch (err: any) {
      return reply.status(500).send({ error: err?.message || 'Upload failed' });
    }
  });

  // GET /onboarding/:workUnitId — get onboarding page for a work unit (public for students)
  fastify.get<{ Params: { workUnitId: string } }>('/onboarding/:workUnitId', async (request, reply) => {
    const { workUnitId } = request.params;

    const wu = await db.workUnit.findUnique({
      where: { id: workUnitId },
      select: { companyId: true, deliverableFormat: true, spec: true, title: true, acceptanceCriteria: true },
    });
    if (!wu) return reply.status(404).send({ error: 'Not found' });

    const company = await db.companyProfile.findUnique({ where: { id: wu.companyId } });
    if (!company) return reply.status(404).send({ error: 'Not found' });

    const addr = (company.address as any) || {};
    const pages = addr.onboardingPages || {};
    const page = pages[workUnitId] || {};

    // Also check for visual editor blocks
    const blocks = page.blocks || addr.onboardingPage?.blocks || [];

    return reply.send({
      title: wu.title || '',
      spec: wu.spec || '',
      acceptanceCriteria: wu.acceptanceCriteria || [],
      welcome: page.welcome || '',
      instructions: page.instructions || '',
      checklist: page.checklist || [],
      exampleWorkUrls: page.exampleWorkUrls || [],
      communicationChannel: page.communicationChannel || '',
      deliverableSubmissionMethod: page.deliverableSubmissionMethod || '',
      deliverableFormat: wu.deliverableFormat || [],
      blocks, // Visual editor blocks for rich onboarding pages
    });
  });

  // PUT /contracts/:id — update a contract
  fastify.put<{ Params: { id: string } }>('/contracts/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const { id } = request.params;
    const { content, title, status } = request.body as { content?: string; title?: string; status?: string };

    const existing = await db.legalAgreement.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Contract not found' });

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (status !== undefined) data.status = status;
    if (content !== undefined) {
      data.content = content;
      if (content !== existing.content) data.version = existing.version + 1;
    }

    const updated = await db.legalAgreement.update({ where: { id }, data });
    return reply.send(updated);
  });

  // DELETE /contracts/:id — delete a contract
  fastify.delete<{ Params: { id: string } }>('/contracts/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const { id } = request.params;
    const existing = await db.legalAgreement.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Contract not found' });
    if (existing.status === 'active') return reply.status(400).send({ error: 'Cannot delete active contract. Archive it first.' });

    // Delete all related records
    await db.agreementSignature.deleteMany({ where: { agreementId: id } });
    try { await (db as any).onboardingStep.deleteMany({ where: { agreementId: id } }); } catch {}
    await db.legalAgreement.delete({ where: { id } });
    return reply.send({ success: true });
  });

  // GET /contracts — list legal agreements, optionally filtered by work unit
  fastify.get('/contracts', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const { workUnitId } = request.query as { workUnitId?: string };

    let agreements;
    if (workUnitId) {
      // Filter contracts that belong to this work unit (stored in slug as wu:{workUnitId})
      agreements = await db.legalAgreement.findMany({
        where: { slug: { startsWith: `wu-${workUnitId.slice(0, 8)}` } },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { signatures: true } } },
      });
    } else {
      agreements = await db.legalAgreement.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { signatures: true } } },
      });
    }

    return reply.send({ contracts: agreements });
  });
}
