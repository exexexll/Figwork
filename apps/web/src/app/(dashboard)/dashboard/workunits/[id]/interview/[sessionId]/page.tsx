'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  ArrowLeft,
  Mic,
  User,
  Bot,
  Clock,
  CheckCircle,
  AlertCircle,
  Star,
  FileText,
} from 'lucide-react';

interface TranscriptMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
}

interface InterviewSummary {
  id: string;
  strengths: string[] | null;
  gaps: string[] | null;
  rawSummary: string | null;
}

interface SessionData {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  transcriptMessages: TranscriptMessage[];
  summary: InterviewSummary | null;
  candidateFiles: Array<{
    id: string;
    filename: string;
    fileType: string;
    cloudinaryUrl: string;
  }>;
}

export default function InterviewTranscriptPage() {
  const params = useParams();
  const { getToken } = useAuth();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workUnitId = params.id as string;
  const sessionId = params.sessionId as string;

  useEffect(() => {
    loadSession();
  }, [sessionId]);

  async function loadSession() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/workunits/${workUnitId}/interviews/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load interview session');
      const data = await res.json();
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load interview');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-48"></div>
          <div className="h-96 bg-slate-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-700">Interview not found</h2>
        <p className="text-slate-500 text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      <Link
        href={`/dashboard/workunits/${workUnitId}`}
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Work Unit
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
          <Mic className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Screening Interview Transcript</h1>
          <div className="text-sm text-slate-500 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {session.status === 'completed' ? 'Completed' : session.status}
              {session.completedAt && ` · ${new Date(session.completedAt).toLocaleDateString()}`}
            </span>
          </div>
        </div>
      </div>

      {/* AI Summary */}
      {session.summary && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" />
            AI Summary
          </h2>
          {session.summary.rawSummary && (
            <p className="text-sm text-slate-700 whitespace-pre-wrap mb-4">{session.summary.rawSummary}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {session.summary.strengths && (session.summary.strengths as string[]).length > 0 && (
              <div className="p-3 bg-green-50 rounded-lg">
                <h3 className="text-xs font-semibold text-green-800 uppercase mb-2">Strengths</h3>
                <ul className="space-y-1">
                  {(session.summary.strengths as string[]).map((s, i) => (
                    <li key={i} className="text-sm text-green-700 flex items-start gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {session.summary.gaps && (session.summary.gaps as string[]).length > 0 && (
              <div className="p-3 bg-red-50 rounded-lg">
                <h3 className="text-xs font-semibold text-red-800 uppercase mb-2">Gaps</h3>
                <ul className="space-y-1">
                  {(session.summary.gaps as string[]).map((g, i) => (
                    <li key={i} className="text-sm text-red-700 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Uploaded Files */}
      {session.candidateFiles && session.candidateFiles.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            Uploaded Files ({session.candidateFiles.length})
          </h2>
          <div className="space-y-2">
            {session.candidateFiles.map(file => (
              <a
                key={file.id}
                href={file.cloudinaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-700">{file.filename}</div>
                  <div className="text-xs text-slate-500">{file.fileType}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Transcript */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">
            Transcript ({session.transcriptMessages.length} messages)
          </h2>
        </div>
        <div className="divide-y divide-slate-50">
          {session.transcriptMessages.map(msg => (
            <div key={msg.id} className={`p-4 ${msg.role === 'interviewer' ? 'bg-blue-50/30' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                {msg.role === 'interviewer' ? (
                  <Bot className="w-4 h-4 text-blue-500" />
                ) : (
                  <User className="w-4 h-4 text-slate-500" />
                )}
                <span className="text-xs font-semibold text-slate-600 uppercase">
                  {msg.role === 'interviewer' ? 'AI Interviewer' : 'Candidate'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed pl-6">{msg.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
