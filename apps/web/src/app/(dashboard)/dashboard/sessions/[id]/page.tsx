'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Play,
  FileText,
  Download,
  CheckCircle,
  AlertTriangle,
  MessageSquare,
  User,
  Mail,
  Building,
  HelpCircle,
  ListChecks,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { getSession, getSessionTranscript, getSessionAudio, exportSession, regenerateSummary } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';
import type { Session, TranscriptMessage, CandidateFile } from '@/lib/types';

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = await getToken();
        if (!token) return;

        const [sessionRes, transcriptRes] = await Promise.all([
          getSession(id, token),
          getSessionTranscript(id, token),
        ]);

        setSession(sessionRes.data);
        setTranscript(transcriptRes.data || []);

        // Fetch audio URL if available
        if (sessionRes.data.audioPublicId || sessionRes.data.audioUrl) {
          try {
            // If audioUrl is already stored, use it directly
            if (sessionRes.data.audioUrl) {
              setAudioUrl(sessionRes.data.audioUrl);
            } else {
              const audioRes = await getSessionAudio(id, token);
              setAudioUrl(audioRes.data.url);
            }
          } catch {
            // Audio not available
          }
        }
      } catch (error) {
        console.error('Failed to fetch session:', error);
        toast.error('Failed to load session');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id, getToken]);

  const handleExport = async (format: 'txt' | 'json' | 'pdf') => {
    setExporting(true);
    try {
      const token = await getToken();
      if (!token) return;

      if (format === 'json') {
        const data = await exportSession(id, 'json', token);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `application-${id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const blob = await exportSession(id, format, token);
        const url = URL.createObjectURL(blob as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `application-${id}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      toast.success('Export downloaded');
    } catch (error) {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const token = await getToken();
      if (!token) return;

      await regenerateSummary(id, token);
      toast.success('Summary regeneration started. Refresh in a few seconds.');
      
      // Refetch after a delay
      setTimeout(async () => {
        const sessionRes = await getSession(id, token);
        setSession(sessionRes.data);
        setRegenerating(false);
      }, 3000);
    } catch (error) {
      toast.error('Failed to regenerate summary');
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-border rounded w-1/4" />
          <div className="h-64 bg-border/50 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-8">
        <p className="text-text-secondary">Session not found</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Back link */}
      <Link
        href="/dashboard/sessions"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Sessions
      </Link>

      {/* Page Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            {session.template?.name}
          </h1>
          <p className="text-text-secondary mt-1">
            {new Date(session.createdAt).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {audioUrl && (
            <Button variant="secondary" asChild>
              <a href={audioUrl} target="_blank" rel="noopener noreferrer">
                <Play className="w-4 h-4 mr-2" />
                Play Audio
              </a>
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => handleExport('txt')}
              disabled={exporting}
            >
              <Download className="w-4 h-4 mr-2" />
              TXT
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport('json')}
              disabled={exporting}
            >
              JSON
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport('pdf')}
              disabled={exporting}
            >
              PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Summary (if available) */}
      {session.summary && (
        <Card className="mb-8">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              AI Summary
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              disabled={regenerating}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              {regenerating ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-1" />
              )}
              {regenerating ? 'Regenerating...' : 'Regenerate'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Check if this is an inquiry session (has visitor_info in rubricCoverage) */}
            {session.mode === 'inquiry' && session.summary?.rubricCoverage ? (
              <>
                {/* Visitor Info - for inquiry mode */}
                {(session.summary.rubricCoverage as any)?.visitor_info && (
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-500" />
                      Visitor Information
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {(session.summary.rubricCoverage as any).visitor_info.name && (
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                          <User className="w-3 h-3" />
                          <span>{(session.summary.rubricCoverage as any).visitor_info.name}</span>
                        </div>
                      )}
                      {(session.summary.rubricCoverage as any).visitor_info.email && (
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                          <Mail className="w-3 h-3" />
                          <span>{(session.summary.rubricCoverage as any).visitor_info.email}</span>
                        </div>
                      )}
                      {(session.summary.rubricCoverage as any).visitor_info.company && (
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                          <Building className="w-3 h-3" />
                          <span>{(session.summary.rubricCoverage as any).visitor_info.company}</span>
                        </div>
                      )}
                      {(session.summary.rubricCoverage as any).visitor_info.role && (
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                          <User className="w-3 h-3" />
                          <span>{(session.summary.rubricCoverage as any).visitor_info.role}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Topics Discussed - stored in strengths for inquiry */}
                {session.summary?.strengths && session.summary.strengths.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-violet-500" />
                      Topics Discussed
                    </h4>
                    <ul className="space-y-1">
                      {session.summary.strengths.map((topic: string, i: number) => (
                        <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="text-violet-500 mt-1">•</span>
                          {topic}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Questions - stored in supportingQuotes for inquiry */}
                {session.summary?.supportingQuotes && session.summary.supportingQuotes.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-blue-500" />
                      Questions Asked
                    </h4>
                    <ul className="space-y-1">
                      {session.summary.supportingQuotes.map((question: string, i: number) => (
                        <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="text-blue-500 mt-1">?</span>
                          {question}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Action Items - stored in gaps for inquiry */}
                {session.summary?.gaps && session.summary.gaps.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                      <ListChecks className="w-4 h-4 text-amber-500" />
                      Follow-up Items
                    </h4>
                    <ul className="space-y-1">
                      {session.summary.gaps.map((item: string, i: number) => (
                        <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="text-amber-500 mt-1">→</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Application mode summary - original */}
                {/* Strengths */}
                {session.summary?.strengths && session.summary.strengths.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Strengths
                    </h4>
                    <ul className="space-y-1">
                      {session.summary.strengths.map((strength: string, i: number) => (
                        <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="text-green-500 mt-1">•</span>
                          {strength}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Gaps */}
                {session.summary?.gaps && session.summary.gaps.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Areas for Improvement
                    </h4>
                    <ul className="space-y-1">
                      {session.summary.gaps.map((gap: string, i: number) => (
                        <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="text-amber-500 mt-1">•</span>
                          {gap}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {/* Narrative - shown for both modes */}
            {session.summary.rawSummary && (
              <div>
                <h4 className="text-sm font-semibold text-text-primary mb-2">Overview</h4>
                <p className="text-sm text-text-secondary whitespace-pre-wrap">
                  {session.summary.rawSummary}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Candidate Files (if any) */}
      {session.candidateFiles && session.candidateFiles.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base">Candidate Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {session.candidateFiles?.map((file: CandidateFile) => (
                <a
                  key={file.id}
                  href={file.cloudinaryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 bg-background-secondary rounded-lg hover:bg-border-light transition-colors"
                >
                  <FileText className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-primary">{file.filename}</span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transcript */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Full Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {transcript.map((message, index) => {
              const isAI = message.role === 'ai';
              const prevMessage = transcript[index - 1];
              const showQuestion =
                message.question &&
                (!prevMessage || prevMessage.question?.id !== message.question?.id);

              return (
                <div key={message.id}>
                  {showQuestion && message.question && (
                    <div className="mb-4 pb-4 border-b border-border-light">
                      <p className="text-xs text-primary font-medium uppercase tracking-wide">
                        Question {message.question.orderIndex + 1}
                      </p>
                      <p className="text-sm text-text-primary font-medium mt-1">
                        {message.question.questionText}
                      </p>
                    </div>
                  )}

                  <div
                    className={cn(
                      'flex gap-3',
                      isAI ? 'justify-start' : 'justify-end'
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[90%] px-4 py-3 rounded-2xl',
                        isAI
                          ? 'bg-primary-light/20 rounded-tl-sm'
                          : 'bg-background-secondary rounded-tr-sm'
                      )}
                    >
                      <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{message.content}</p>
                      <p className="text-xs text-text-muted mt-1">
                        {new Date(Number(message.timestampMs)).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
