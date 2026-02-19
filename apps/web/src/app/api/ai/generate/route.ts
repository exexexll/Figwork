import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type FieldType = 'persona' | 'tone' | 'question' | 'rubric' | 'inquiry_welcome' | 'inquiry_goal' | 'voice_intro';

const FIELD_SYSTEM_PROMPTS: Record<FieldType, string> = {
  persona: `You are an expert at crafting AI interviewer personas. Generate a professional, engaging persona description for an AI interviewer. The persona should be:
- Friendly but professional
- Specific about their role/background (give them a name and title)
- Clear about their interview approach
- 2-3 sentences max
Output ONLY the persona text, no explanations.`,

  tone: `You are an expert at defining conversation tone. Generate clear tone guidance for an AI interviewer. The guidance should:
- Define the emotional register (warm, professional, casual, etc.)
- Specify how to handle different situations
- Be actionable and specific
- 1-2 sentences max
Output ONLY the tone guidance, no explanations.`,

  question: `You are an expert interviewer. Generate a thoughtful, open-ended interview question that:
- Encourages detailed responses
- Reveals skills, experience, or thinking process
- Is clear and concise
- Avoids yes/no answers
Output ONLY the question, no explanations.`,

  rubric: `You are an expert at creating evaluation criteria. Generate a concise rubric for assessing interview answers. Include:
- Key points or themes to look for
- What distinguishes a good vs great answer
- Be specific and actionable
- 2-3 bullet points, formatted as a short paragraph
Output ONLY the rubric text, no explanations.`,

  inquiry_welcome: `You are an expert at crafting welcoming messages. Generate a warm, professional welcome message for an AI assistant greeting visitors. The message should:
- Be friendly and inviting
- Offer help without being pushy
- Be conversational, not corporate
- 1-2 sentences max
Output ONLY the welcome message, no explanations.`,

  inquiry_goal: `You are an expert at defining conversation objectives. Generate instructions for an AI assistant on what information to gather during a visitor conversation. Include:
- Key information to collect (name, email, purpose, etc.)
- How to naturally ask for this without being intrusive
- Priorities (what's most important)
- 2-3 sentences max
Output ONLY the goal instructions, no explanations.`,

  voice_intro: `You are an expert at crafting spoken introductions. Generate a natural, warm introduction for an AI to speak at the start of a voice interview. It should:
- Sound natural when spoken aloud (conversational)
- Welcome the candidate
- Briefly explain what will happen
- Be encouraging and put them at ease
- 2-3 sentences max
Output ONLY the introduction, no explanations.`,
};

const REFINE_SYSTEM_PROMPT = `You are an expert editor. Your task is to improve and refine the given text while maintaining its core intent. Make it:
- Clearer and more concise
- More professional and polished
- Better structured if needed
Keep the same general meaning and length. Output ONLY the improved text, no explanations or commentary.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fieldType, currentValue, action, context } = body as {
      fieldType: FieldType;
      currentValue?: string;
      action: 'generate' | 'refine';
      context?: string;
    };

    if (!fieldType || !FIELD_SYSTEM_PROMPTS[fieldType]) {
      return NextResponse.json(
        { error: 'Invalid field type' },
        { status: 400 }
      );
    }

    let systemPrompt: string;
    let userPrompt: string;

    if (action === 'refine' && currentValue) {
      systemPrompt = REFINE_SYSTEM_PROMPT;
      userPrompt = `Improve this ${fieldType.replace('_', ' ')} text:\n\n"${currentValue}"${context ? `\n\nContext: ${context}` : ''}`;
    } else {
      systemPrompt = FIELD_SYSTEM_PROMPTS[fieldType];
      userPrompt = context 
        ? `Generate content. Context: ${context}` 
        : 'Generate content.';
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const text = completion.choices[0]?.message?.content?.trim() || '';

    return NextResponse.json({ text });
  } catch (error) {
    console.error('AI generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate content' },
      { status: 500 }
    );
  }
}
