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
  return `You are the Figwork business assistant for ${company.companyName || 'this company'}. You help manage contract work — creating tasks, hiring contractors, reviewing submissions, and tracking spending.

You have tools to take real actions. Use them when the user asks you to do something. Always confirm before creating or spending.

Current state:
- Active work units: ${context.activeWorkUnits}
- In-progress executions: ${context.inProgressExecutions}
- Pending reviews: ${context.pendingReviews}
- Monthly spend: $${(context.monthlySpend / 100).toFixed(2)}

Guidelines:
- Be concise. No bullet lists, no markdown headers. Write in plain conversational sentences.
- When showing tool results, summarize briefly. Don't repeat raw data.
- If the user's request is unclear, ask one clarifying question.
- Before creating a work unit or spending money, confirm the details with the user first.
- When estimating costs, show the breakdown clearly.
- Refer to contractors as "contractors" not "students".`;
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
    const history = conversation.messages || [];
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === 'user') {
        openaiMessages.push({ role: 'user', content: msg.content || '' });
      } else if (msg.role === 'assistant') {
        const assistantMsg: any = { role: 'assistant', content: msg.content || '' };
        if (msg.toolCalls && Array.isArray(msg.toolCalls) && (msg.toolCalls as any[]).length > 0) {
          assistantMsg.tool_calls = msg.toolCalls;
          openaiMessages.push(assistantMsg);
          // Collect all following tool messages that belong to this assistant message
          const toolCallIds = new Set((msg.toolCalls as any[]).map((tc: any) => tc.id));
          while (i + 1 < history.length && history[i + 1].role === 'tool') {
            i++;
            const toolMsg = history[i];
            const results = toolMsg.toolResults as any;
            if (results?.toolCallId && toolCallIds.has(results.toolCallId)) {
              openaiMessages.push({
                role: 'tool',
                tool_call_id: results.toolCallId,
                content: results.content || '',
              });
            }
          }
        } else {
          openaiMessages.push(assistantMsg);
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
      let maxLoops = 5;

      while (maxLoops-- > 0) {
        const stream = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: loopMessages,
          tools: TOOL_DEFINITIONS,
          stream: true,
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
      console.error('[Agent] Error:', err);
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Agent error' })}\n\n`);
      reply.raw.end();
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
}
