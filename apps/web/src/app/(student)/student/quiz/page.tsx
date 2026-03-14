'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import {
  generateDailyQuiz,
  submitDailyQuiz,
  QuizQuestion,
  QuizGenerateResponse,
  QuizSubmitResponse,
} from '@/lib/marketplace-api';

const ACCENT = '#a2a3fc';

export default function QuizPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [category, setCategory] = useState<string>('general');
  const [quiz, setQuiz] = useState<QuizGenerateResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizSubmitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = [
    { value: 'general', label: 'General' },
    { value: 'writing', label: 'Writing' },
    { value: 'design', label: 'Design' },
    { value: 'data-entry', label: 'Data Entry' },
    { value: 'research', label: 'Research' },
    { value: 'programming', label: 'Programming' },
  ];

  async function loadQuiz() {
    try {
      setLoading(true);
      setError(null);
      setResult(null);
      setAnswers({});
      const token = await getToken();
      if (!token) return;
      const data = await generateDailyQuiz(category, token);
      setQuiz(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate quiz');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!quiz) return;
    
    // Validate all questions are answered
    const unanswered = quiz.questions.filter(q => !answers[q.id]);
    if (unanswered.length > 0) {
      setError(`Please answer all ${unanswered.length} remaining question${unanswered.length > 1 ? 's' : ''}`);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const token = await getToken();
      if (!token) return;
      const data = await submitDailyQuiz(
        {
          category: quiz.category,
          questions: quiz.questions,
          answers: quiz.questions.map(q => answers[q.id]),
        },
        token
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit quiz');
    } finally {
      setSubmitting(false);
    }
  }

  function handleAnswer(questionId: string, answer: any) {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  }

  function handleNewQuiz() {
    setQuiz(null);
    setAnswers({});
    setResult(null);
    setError(null);
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50';
    if (score >= 60) return 'text-blue-600 bg-blue-50';
    return 'text-yellow-600 bg-yellow-50';
  };

  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-[#f0f0ff] flex items-center justify-center">
            <BookOpen className="w-5 h-5" style={{ color: ACCENT }} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[#1f1f2e]">Competency Quiz</h1>
            <p className="text-sm text-[#6b6b80] mt-0.5">
              Test your skills and unlock more daily tasks
            </p>
          </div>
        </div>
      </div>

      {/* Category Selection (if no quiz) */}
      {!quiz && !result && (
        <Card className="p-6 mb-6 !border-[#e0e0f0] !bg-white">
          <h2 className="text-lg font-semibold text-[#1f1f2e] mb-4">Select Category</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {categories.map(cat => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={cn(
                  'px-4 py-3 rounded-lg text-sm font-medium transition-all',
                  category === cat.value
                    ? 'bg-[#f0f0ff] text-[#a2a3fc] border-2 border-[#a2a3fc]'
                    : 'bg-[#f5f5f5] text-[#6b6b80] border-2 border-transparent hover:border-[#e0e0e8]'
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <button
            onClick={loadQuiz}
            disabled={loading}
            className={cn(
              'mt-6 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white transition-all',
              'hover:opacity-90',
              loading && 'opacity-50 cursor-not-allowed'
            )}
            style={{ backgroundColor: ACCENT }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating Quiz...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Quiz
              </>
            )}
          </button>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="p-4 mb-6 !border-[#e0e0f0] !bg-[#f0f0ff]">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: ACCENT }} />
            <div className="flex-1">
              <p className="text-sm text-[#6b6b80]">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs mt-2 text-[#a2a3fc] hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Quiz Questions */}
      {quiz && !result && (
        <div className="space-y-6">
          <Card className="p-6 !border-[#e0e0f0] !bg-white">
            <h2 className="text-xl font-semibold text-[#1f1f2e] mb-2">{quiz.title}</h2>
            <p className="text-sm text-[#6b6b80]">Category: {quiz.category}</p>
          </Card>

          {quiz.questions.map((question, idx) => (
            <Card key={question.id} className="p-6 !border-[#e0e0f0] !bg-white">
              <div className="mb-4">
                <span className="text-xs font-medium text-[#a2a3fc] mb-2 block">
                  Question {idx + 1} of {quiz.questions.length}
                </span>
                <h3 className="text-lg font-semibold text-[#1f1f2e]">{question.prompt}</h3>
              </div>

              {question.type === 'multiple_choice' && question.choices ? (
                <div className="space-y-2">
                  {question.choices.map((choice, choiceIdx) => (
                    <button
                      key={choiceIdx}
                      onClick={() => handleAnswer(question.id, choice)}
                      className={cn(
                        'w-full text-left px-4 py-3 rounded-lg border-2 transition-all',
                        answers[question.id] === choice
                          ? 'border-[#a2a3fc] bg-[#f0f0ff] text-[#1f1f2e]'
                          : 'border-[#f0f0f5] bg-white text-[#6b6b80] hover:border-[#e0e0e8]'
                      )}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              ) : question.type === 'math' ? (
                <input
                  type="number"
                  value={answers[question.id] || ''}
                  onChange={e => handleAnswer(question.id, e.target.value)}
                  placeholder="Enter your answer"
                  className="w-full px-4 py-3 rounded-lg border border-[#f0f0f5] bg-white text-[#1f1f2e] focus:outline-none focus:border-[#a2a3fc] transition-colors"
                />
              ) : (
                <textarea
                  value={answers[question.id] || ''}
                  onChange={e => handleAnswer(question.id, e.target.value)}
                  placeholder="Type your answer here..."
                  rows={4}
                  className="w-full px-4 py-3 rounded-lg border border-[#f0f0f5] bg-white text-[#1f1f2e] focus:outline-none focus:border-[#a2a3fc] transition-colors resize-none"
                />
              )}
            </Card>
          ))}

          <div className="flex gap-3">
            <button
              onClick={handleNewQuiz}
              className="flex-1 px-4 py-3 rounded-lg text-sm font-medium border border-[#f0f0f5] bg-white text-[#6b6b80] hover:bg-[#f5f5f5] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white transition-all',
                'hover:opacity-90',
                submitting && 'opacity-50 cursor-not-allowed'
              )}
              style={{ backgroundColor: ACCENT }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  Submit Quiz
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          <Card className="p-8 !border-[#e0e0f0] !bg-white text-center">
            <div className={cn('inline-flex items-center justify-center w-16 h-16 rounded-full mb-4', getScoreColor(result.score))}>
              {result.unlocked ? (
                <Trophy className="w-8 h-8 text-green-600" />
              ) : (
                <TrendingUp className="w-8 h-8 text-blue-600" />
              )}
            </div>
            <h2 className="text-2xl font-bold text-[#1f1f2e] mb-2">
              Score: {result.score}%
            </h2>
            {result.unlocked ? (
              <p className="text-green-600 font-medium mb-4">
                🎉 Great job! You've unlocked more daily tasks!
              </p>
            ) : (
              <p className="text-[#6b6b80] mb-4">
                Keep practicing to unlock more tasks (60%+ required)
              </p>
            )}
            {result.summary && (
              <div className="mt-6 p-4 bg-[#f5f5f5] rounded-lg text-left">
                <p className="text-sm text-[#6b6b80] whitespace-pre-wrap">{result.summary}</p>
              </div>
            )}
          </Card>

          <div className="flex gap-3">
            <Link
              href="/student/daily-tasks"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
              style={{ backgroundColor: ACCENT }}
            >
              View Daily Tasks
              <ArrowRight className="w-4 h-4" />
            </Link>
            <button
              onClick={handleNewQuiz}
              className="flex-1 px-4 py-3 rounded-lg text-sm font-medium border border-[#f0f0f5] bg-white text-[#6b6b80] hover:bg-[#f5f5f5] transition-all"
            >
              Take Another Quiz
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
