import { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import { verifyClerkAuth } from '../lib/clerk.js';
import { forbidden, badRequest } from '../lib/http-errors.js';
import { getOpenAIClient } from '@figwork/ai';

async function getStudent(request: any, reply: any) {
  const auth = await verifyClerkAuth(request, reply);
  if (!auth) return null;
  const student = await db.studentProfile.findUnique({ where: { clerkId: auth.userId } });
  if (!student) {
    forbidden(reply, 'Student profile required');
    return null;
  }
  return student;
}

function parseJson(raw: string): any {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return {};
}

export default async function quizRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { category?: string } }>('/daily-quiz/generate', async (request, reply) => {
    const student = await getStudent(request, reply);
    if (!student) return;

    const category = request.body?.category || 'general';
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        {
          role: 'system',
          content:
            'Generate a short competency quiz as strict JSON. Return {"title":"...","category":"...","questions":[{"id":"q1","type":"open|multiple_choice|math","prompt":"...","choices":["..."]?,"rubric":"...","answer":"...?"}]}. Make exactly 3 questions. Tailor to the requested task category. No markdown.',
        },
        {
          role: 'user',
          content: `Student skills: ${(student.skillTags || []).join(', ')}\nSpecializations: ${(student.specializations || []).join(', ')}\nGenerate quiz for category: ${category}`,
        },
      ],
      max_completion_tokens: 1800,
      response_format: { type: 'json_object' },
    });
    const data = parseJson(completion.choices[0]?.message?.content || '{}');
    return reply.send(data);
  });

  fastify.post<{ Body: { category: string; questions: any[]; answers: any[] } }>('/daily-quiz/submit', async (request, reply) => {
    const student = await getStudent(request, reply);
    if (!student) return;
    const { category, questions, answers } = request.body || {};
    if (!category || !Array.isArray(questions) || !Array.isArray(answers)) {
      return badRequest(reply, 'category, questions and answers are required');
    }

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        {
          role: 'system',
          content:
            'Score the quiz as strict JSON. Return {"score":0-100,"summary":"...","signals":[{"category":"...","score":0-100,"strength":"..."}]}. Be concise and fair. No markdown.',
        },
        {
          role: 'user',
          content: JSON.stringify({ category, questions, answers }),
        },
      ],
      max_completion_tokens: 1200,
      response_format: { type: 'json_object' },
    });
    const scored = parseJson(completion.choices[0]?.message?.content || '{}');
    const score = Number(scored.score || 0);

    const anyDb = db as any;
    const result = await anyDb.quizResult.create({
      data: {
        studentId: student.id,
        category,
        questions,
        answers,
        score,
        summary: scored.summary || null,
      },
    }).catch(() => null);

    await anyDb.skillSignal.create({
      data: {
        studentId: student.id,
        category,
        signalType: 'quiz',
        score,
        evidence: {
          quizResultId: result?.id || null,
          signals: scored.signals || [],
        },
      },
    }).catch(() => null);

    return reply.send({
      score,
      summary: scored.summary || '',
      unlocked: score >= 60,
      resultId: result?.id || null,
    });
  });
}
