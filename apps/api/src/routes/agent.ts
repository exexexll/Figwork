/**
 * Agent Route — conversational AI for the business panel.
 * Single streaming endpoint that handles all business operations through chat.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';
import { getOpenAIClient } from '@figwork/ai';
import { verifyClerkAuth } from '../lib/clerk.js';
import { TOOL_DEFINITIONS, executeTool } from '../lib/agent-tools.js';

function buildSystemPrompt(company: any, context: any): string {
  return `You are the Figwork assistant for ${company.companyName || 'this company'}.

You manage the full lifecycle of contract work: creating tasks, screening contractors via AI interviews, tracking execution, reviewing deliverables, and handling payments.

Right now this company has ${context.activeWorkUnits} active tasks, ${context.inProgressExecutions} in-progress executions, ${context.pendingReviews} submissions awaiting review, and has spent $${(context.monthlySpend / 100).toFixed(2)} this month.

You can:
- Create, edit, publish, pause, or delete work units (tasks)
- Set acceptance criteria, required skills, deliverable formats, milestones, complexity, tier requirements
- Estimate campaign costs and draft statements of work
- Create and configure AI screening interviews with custom questions
- Generate shareable interview links
- View interview transcripts and session summaries
- Find and assign matched contractors, or let the auto-matching system handle it
- Review submitted work (approve, request revision, or reject)
- Track execution progress, milestones, and proof-of-work logs
- View and manage billing, invoices, budget periods, and escrow
- View analytics, notifications, disputes

When the user asks you to do something, use the right tool. When creating or spending, confirm details first in one short sentence, then act. After completing an action, briefly state what happened and suggest the logical next step.

You can create multiple work units in a single response by calling create_work_unit multiple times. When the user describes a campaign or batch of tasks, break it down and create each one.

SPEC WRITING METHODOLOGY — when creating a work unit, always follow this process:
1. Ask the user about: what exactly needs to be delivered, who the audience is, what format they want, any examples or references, quality standards, and anything the contractor must avoid.
2. If the user gives a vague description, ask 2-3 targeted clarifying questions before proceeding. Never create a work unit with a one-sentence spec.
3. When you have enough detail, write a comprehensive spec that includes: context/background, detailed deliverable description, format requirements, quality standards, what "done" looks like, and any constraints. The spec should be clear enough that a contractor can start working without asking questions.
4. Show the user the spec and ask for confirmation before creating.
5. After creating, suggest adding acceptance criteria, milestones, and a screening interview if the task is complex.

CONTRACT CREATION — you have two paths:
1. draft_sow / draft_nda / draft_msa — generates a document as text in the chat for review.
2. create_contract — creates a REAL legal agreement in the system that contractors MUST sign before starting work. This integrates directly into the student onboarding flow.

When the user asks to create a contract for a task:
- Use create_contract with a complete, enforceable contract tailored to the specific work. Include: parties (use the company name), scope referencing the work unit spec, deliverables, IP assignment, confidentiality, payment terms, revision policy, termination, dispute resolution, and contractor acknowledgments.
- After creating, remind the user to activate_contract so it becomes required during onboarding.
- If a workUnitId is provided, the contract is automatically linked to that task.
- Always write contracts in plain English, no legalese jargon. Clear, direct, enforceable.

Write in plain short sentences. No markdown formatting, no bullet points, no headers. Just conversational text. Refer to workers as "contractors".`;
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
