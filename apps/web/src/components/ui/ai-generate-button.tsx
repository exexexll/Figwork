'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AIGenerateButtonProps {
  fieldType: 'persona' | 'tone' | 'question' | 'rubric' | 'inquiry_welcome' | 'inquiry_goal' | 'voice_intro';
  currentValue: string;
  onGenerate: (text: string) => void;
  context?: string; // Additional context like template name, other questions, etc.
  className?: string;
}

const FIELD_PROMPTS: Record<string, { empty: string; refine: string }> = {
  persona: {
    empty: 'Generate a professional, friendly AI interviewer persona',
    refine: 'Improve and refine this interviewer persona to be more engaging and professional',
  },
  tone: {
    empty: 'Generate tone guidance for an AI interviewer that is professional yet approachable',
    refine: 'Refine this tone guidance to be clearer and more effective',
  },
  question: {
    empty: 'Generate a thoughtful interview question',
    refine: 'Improve this question to be clearer and more insightful',
  },
  rubric: {
    empty: 'Generate evaluation criteria for assessing the answer quality',
    refine: 'Improve this rubric to be more comprehensive and actionable',
  },
  inquiry_welcome: {
    empty: 'Generate a warm, welcoming message for visitors starting a conversation',
    refine: 'Improve this welcome message to be more inviting and clear',
  },
  inquiry_goal: {
    empty: 'Generate instructions for what information to gather during the conversation',
    refine: 'Improve these instructions to be clearer and more comprehensive',
  },
  voice_intro: {
    empty: 'Generate a friendly spoken introduction for starting a voice interview',
    refine: 'Improve this introduction to sound more natural when spoken aloud',
  },
};

export function AIGenerateButton({
  fieldType,
  currentValue,
  onGenerate,
  context,
  className,
}: AIGenerateButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    
    try {
      const prompts = FIELD_PROMPTS[fieldType];
      const isRefine = currentValue.trim().length > 0;
      
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldType,
          currentValue: isRefine ? currentValue : undefined,
          action: isRefine ? 'refine' : 'generate',
          context,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate');
      }

      const data = await response.json();
      onGenerate(data.text);
    } catch (error) {
      console.error('AI generation error:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const isRefine = currentValue.trim().length > 0;

  return (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={isGenerating}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md',
        'bg-gradient-to-r from-violet-50 to-purple-50 hover:from-violet-100 hover:to-purple-100',
        'text-violet-700 border border-violet-200/60',
        'transition-all duration-200 ease-out',
        'hover:shadow-sm hover:border-violet-300/60',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:ring-offset-1',
        className
      )}
      title={isRefine ? 'AI will improve your text' : 'AI will generate content'}
    >
      {isGenerating ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Sparkles className="w-3 h-3" />
      )}
      <span>{isGenerating ? 'Generating...' : isRefine ? 'Refine' : 'Generate'}</span>
    </button>
  );
}
