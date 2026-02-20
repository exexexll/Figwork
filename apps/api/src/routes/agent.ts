/**
 * Agent Route — conversational AI for the business panel.
 * Single streaming endpoint that handles all business operations through chat.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import { db } from '@figwork/db';
import { getOpenAIClient } from '@figwork/ai';
import { verifyClerkAuth } from '../lib/clerk.js';
import { TOOL_DEFINITIONS, executeTool } from '../lib/agent-tools.js';

function buildSystemPrompt(company: any, context: any): string {
  const name = company.companyName || 'this company';
  return `You are the Figwork assistant for ${name}. You operate as a team of specialized agents that seamlessly hand off to each other based on what the user needs. The user talks to one interface — you — but behind the scenes you switch between modes.

CURRENT STATE: ${context.activeWorkUnits} active tasks, ${context.inProgressExecutions} in progress, ${context.pendingReviews} awaiting review, $${(context.monthlySpend / 100).toFixed(2)} spent this month.

You have 57 tools. Use them. When creating or spending, confirm first. After any action, state what happened and suggest the next step.

You CAN read files. When a user uploads a PDF, DOCX, or text file, its content is extracted and included in the message. Read and analyze it thoroughly — reference specific details from the document in your response.

You CAN search the web using the web_search tool. Use it when you need current market rates, industry standards, competitor info, legal requirements, or any external data.

===== AGENT MODES =====

MODE 1: SCOPE DESIGNER — activated when user wants to create work or hire someone.
Your job: deeply understand what the business needs before creating anything.

Step 1 — DISCOVERY: Ask about the business goal, not just the task. "What outcome are you trying to achieve?" Then ask about audience, timeline, budget constraints, and quality bar.

Step 2 — DECOMPOSITION: Break the goal into concrete deliverables. If it's a campaign, identify each component. If it's a single task, identify sub-tasks or milestones.

Step 3 — SPEC DRAFTING: For each task, write a comprehensive spec covering: context, detailed requirements, format, quality standards, what "done" looks like, what to avoid, and examples if provided. Never write a one-sentence spec.

Step 4 — REVIEW: Show the spec and ask: "Does this capture what you need? Anything to add or change?" Iterate until confirmed.

Step 5 — SETUP: After confirmation, create work units, set acceptance criteria, add milestones, attach screening interview if complex, set up onboarding page with instructions and examples, estimate total cost, and suggest contractor tier.

Step 6 — LEGAL: Ask if they want a task-specific contract. If yes, draft and create one tailored to the scope.

Step 7 — PUBLISH: Fund escrow and activate. Summarize everything created.

Be flexible — the user can skip any step, jump ahead, or go back. Follow their lead but gently guide toward completeness. If they say "just do it," use your best judgment and confirm key decisions.

MODE 2: OPERATIONS MANAGER — activated when user asks about existing work, reviews, or status.
Check execution status, review submissions, manage disputes, track spending. Be concise — show data, suggest actions.

MODE 3: CONTRACT SPECIALIST — activated when user asks about legal, contracts, NDAs, or compliance.
Use create_contract for real enforceable agreements that integrate into contractor onboarding. Use draft_sow/draft_nda/draft_msa for review documents. Write in plain English. Include: parties, scope, deliverables, IP assignment, confidentiality, payment terms, revision policy, termination, dispute resolution. After creating, remind to activate_contract.

MODE 4: ONBOARDING ARCHITECT — activated when user discusses contractor experience, onboarding, communication, or submission process.
Set up the contractor onboarding page: welcome message, instructions, checklist, example work URLs, communication channel (Slack/Discord/email/platform), deliverable submission method. Make it clear and welcoming — contractors should know exactly what to do.

MODE 5: FINANCIAL ANALYST — activated for budget, cost, invoices, payouts.
Estimate costs, show breakdowns, manage budgets, track escrow.

===== RULES =====

You can create multiple work units at once by calling create_work_unit multiple times.

Write in plain conversational sentences. No markdown formatting, no bullet points, no headers, no bold. Refer to workers as "contractors". Be concise but thorough.

When the user's request is vague, ask ONE focused clarifying question — not a list of questions. Build context progressively through conversation, not interrogation.`;
}

async function getCompanyContext(companyId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [activeWU, inProgressExec, pendingReview, monthlySpend] = await Promise.all([
    db.workUnit.count({ where: { companyId, status: { in: ['active', 'in_progress'] } } }),
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
    const { conversationId, message } = request.body as {
      conversationId?: string;
      message: string;
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

    // Build message history for OpenAI
    const context = await getCompanyContext(company.id);
    const systemPrompt = buildSystemPrompt(company, context);

    const openaiMessages: any[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history — must maintain valid tool_calls→tool pairing
    // OpenAI requires EVERY tool_call_id to have a matching tool response
    const history = conversation.messages || [];
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === 'user') {
        openaiMessages.push({ role: 'user', content: msg.content || '' });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && Array.isArray(msg.toolCalls) && (msg.toolCalls as any[]).length > 0) {
          const toolCalls = msg.toolCalls as any[];
          const requiredIds = new Set(toolCalls.map((tc: any) => tc.id));

          // Peek ahead and collect tool responses
          const toolResponses: any[] = [];
          let j = i + 1;
          while (j < history.length && history[j].role === 'tool') {
            const results = history[j].toolResults as any;
            if (results?.toolCallId && requiredIds.has(results.toolCallId)) {
              toolResponses.push({
                role: 'tool',
                tool_call_id: results.toolCallId,
                content: results.content || '',
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

    // Add current message
    openaiMessages.push({ role: 'user', content: message });

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

    try {
      // Agent loop — handles tool calls iteratively
      let loopMessages = [...openaiMessages];
      let maxLoops = 8; // Allow more tool rounds for complex multi-step tasks

      while (maxLoops-- > 0) {
        const stream = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: loopMessages,
          tools: TOOL_DEFINITIONS,
          stream: true,
          max_tokens: 4096,
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
          } catch {}

          // Send tool activity indicator
          reply.raw.write(`data: ${JSON.stringify({ type: 'tool', name: toolName, status: 'running' })}\n\n`);

          const result = await executeTool(toolName, toolArgs, company.id, user.id);

          reply.raw.write(`data: ${JSON.stringify({ type: 'tool', name: toolName, status: 'done', result })}\n\n`);

          // Save tool result
          await db.agentMessage.create({
            data: {
              conversationId: conversation.id,
              role: 'tool',
              toolResults: { toolCallId: tc.id, content: result },
            },
          });

          // Add to loop messages
          loopMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });

          toolCallsAccumulated.push({ id: tc.id, name: toolName, args: toolArgs, result });
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

        // Continue the loop — GPT will process tool results and generate response
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

      reply.raw.write(`data: ${JSON.stringify({ type: 'done', conversationId: conversation.id })}\n\n`);
      reply.raw.end();
    } catch (err: any) {
      console.error('[Agent] Error:', err?.message || err);
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err?.message?.slice(0, 200) || 'Agent error' })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', conversationId: conversation.id })}\n\n`);
      } catch {} // Stream may already be closed
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
        // Extract text from PDF using simple regex on raw buffer
        // For production, use pdf-parse library
        try {
          const raw = buffer.toString('utf-8');
          // Simple PDF text extraction — find text between BT/ET markers
          const matches = raw.match(/\(([^)]+)\)/g);
          if (matches) {
            text = matches.map(m => m.slice(1, -1)).join(' ').replace(/\\n/g, '\n').slice(0, 15000);
          }
          if (!text || text.length < 50) {
            // Fallback: try to find readable text
            text = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 15000);
          }
        } catch {
          text = '[PDF text extraction failed]';
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

  // GET /onboarding/:workUnitId — get onboarding page for a work unit (public for students)
  fastify.get<{ Params: { workUnitId: string } }>('/onboarding/:workUnitId', async (request, reply) => {
    const { workUnitId } = request.params;

    const wu = await db.workUnit.findUnique({
      where: { id: workUnitId },
      select: { companyId: true, deliverableFormat: true },
    });
    if (!wu) return reply.status(404).send({ error: 'Not found' });

    const company = await db.companyProfile.findUnique({ where: { id: wu.companyId } });
    if (!company) return reply.status(404).send({ error: 'Not found' });

    const pages = ((company.address as any)?.onboardingPages || {});
    const page = pages[workUnitId] || {};

    return reply.send({
      welcome: page.welcome || '',
      instructions: page.instructions || '',
      checklist: page.checklist || [],
      exampleWorkUrls: page.exampleWorkUrls || [],
      communicationChannel: page.communicationChannel || '',
      deliverableSubmissionMethod: page.deliverableSubmissionMethod || '',
      deliverableFormat: wu.deliverableFormat || [],
    });
  });

  // GET /contracts — list legal agreements
  fastify.get('/contracts', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const agreements = await db.legalAgreement.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { signatures: true } } },
    });

    return reply.send({ contracts: agreements });
  });
}
