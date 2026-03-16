'use client';

import { useEffect, useState } from 'react';
import { useMarketplaceEvent, MARKETPLACE_EVENTS } from '@/lib/marketplace-socket';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  DollarSign,
  CheckCircle,
  AlertCircle,
  Upload,
  Play,
  Pause,
  Send,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Plus,
  Trash2,
  Target,
  MessageSquare,
  Shield,
  Loader2,
  Paperclip,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  getExecution,
  clockIn,
  clockOut,
  submitDeliverables,
  completeMilestone,
  getExecutionRevisions,
  Execution,
} from '@/lib/marketplace-api';
import { track, EVENTS } from '@/lib/analytics';
import { cn } from '@/lib/cn';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function ExecutionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const [execution, setExecution] = useState<Execution | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Submit form
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [deliverableUrls, setDeliverableUrls] = useState<string[]>(['']);
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // QA Preview
  const [qaPreview, setQaPreview] = useState<any>(null);
  const [qaLoading, setQaLoading] = useState(false);

  // Chat — unified thread (AI + client messages)
  const [chatTab, setChatTab] = useState<'chat' | 'meeting'>('chat');
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ id?: string; role: string; senderType: string; senderName?: string; content: string; messageType?: string; createdAt?: string }>>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [meetingMessage, setMeetingMessage] = useState('');
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [meetingSent, setMeetingSent] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatAttachments, setChatAttachments] = useState<Array<{ url: string; filename: string; mimetype: string; size: number }>>([]);
  const [chatUploading, setChatUploading] = useState(false);

  const executionId = params.id as string;

  useEffect(() => {
    loadData();
  }, [executionId]);

  // Real-time message updates via WebSocket
  useMarketplaceEvent(MARKETPLACE_EVENTS.EXECUTION_MESSAGE_NEW, (data: any) => {
    if (data.executionId === executionId && data.message) {
      const msg = data.message;
      setChatMessages(prev => {
        // Avoid duplicates
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, {
          id: msg.id,
          role: msg.senderType === 'student' ? 'user' : 'assistant',
          senderType: msg.senderType,
          senderName: msg.senderName,
          content: msg.content,
          messageType: msg.messageType,
          createdAt: msg.createdAt,
        }];
      });
      // Update unread count if message is from company/AI
      if (msg.senderType !== 'student') {
        setUnreadCount(prev => prev + 1);
        // Auto-mark as read if chat is visible
        if (chatTab === 'chat') {
          getToken().then(token => {
            if (token) {
              fetch(`${API_URL}/api/executions/${executionId}/messages/read-all`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              }).catch(() => {});
            }
          });
        }
      }
    }
  }, [executionId, chatTab]);

  async function loadData() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const [execData, revData] = await Promise.all([
        getExecution(executionId, token),
        getExecutionRevisions(executionId, token).catch(() => []),
      ]);

      // ── Onboarding/Contract enforcement ──
      // ALWAYS redirect to onboard page on first visit for new executions
      // The onboard page handles: contracts, onboarding content, and skip logic
      if (execData && ['assigned', 'pending_review', 'pending_screening'].includes(execData.status) && !onboardingChecked) {
        const localOnboarded = typeof window !== 'undefined' && localStorage.getItem(`onboarded_${executionId}`);
        if (!localOnboarded) {
          // Always go to onboard page — it will skip itself if nothing is needed
          router.push(`/student/executions/${executionId}/onboard`);
          return;
        }
        setOnboardingChecked(true);
      }

      setExecution(execData);
      setRevisions(revData);

      // Load message thread
      try {
        const msgRes = await fetch(`${API_URL}/api/executions/${executionId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          const serverMessages = (msgData.messages || []).map((m: any) => ({
            id: m.id,
            role: m.senderType === 'student' ? 'user' : 'assistant',
            senderType: m.senderType,
            senderName: m.senderName,
            content: m.content,
            messageType: m.messageType,
            createdAt: m.createdAt,
          }));
          setChatMessages(serverMessages);
          setUnreadCount(msgData.unreadCount || 0);

          // Mark all as read
          if (msgData.unreadCount > 0) {
            fetch(`${API_URL}/api/executions/${executionId}/messages/read-all`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
          }
        }
      } catch {}
    } catch (err) {
      console.error('Failed to load execution:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleQAPreview() {
    try {
      setQaLoading(true);
      setError(null);
      const token = await getToken();
      if (!token) return;
      const urls = deliverableUrls.filter(u => u.trim());
      if (urls.length === 0) {
        setError('Please add at least one deliverable URL before running QA check');
        setQaLoading(false);
        return;
      }
      const res = await fetch(`${API_URL}/api/executions/${executionId}/qa-preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverableUrls: urls }),
      });
      if (res.ok) {
        const data = await res.json();
        setQaPreview(data);
      } else {
        const errorData = await res.json().catch(() => ({ error: 'QA check failed' }));
        setError(errorData.error || 'QA check failed. Please try again.');
      }
    } catch (err) {
      console.error('QA preview failed:', err);
      setError('Failed to run QA check. Please try again.');
    } finally {
      setQaLoading(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!assistantQuestion.trim() || assistantQuestion.length < 3) return;
    const q = assistantQuestion.trim();
    setAssistantQuestion('');

    // Add user message to chat immediately (optimistic update)
    const tempId = `temp-${Date.now()}`;
    const userMsg = { id: tempId, role: 'user' as const, senderType: 'student', content: q, createdAt: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      setAssistantLoading(true);
      setError(null);
      const token = await getToken();
      if (!token) return;

      // Save the user message to the server thread
      const attachments = chatAttachments;
      const msgRes = await fetch(`${API_URL}/api/executions/${executionId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: q, messageType: 'text', attachments: attachments.length > 0 ? attachments : undefined }),
      });
      setChatAttachments([]);
      if (!msgRes.ok) {
        const errData = await msgRes.json().catch(() => ({}));
        console.error('Failed to save message:', errData);
        // Remove optimistic message if save failed
        setChatMessages(prev => prev.filter(m => m.id !== tempId));
        setChatMessages(prev => [...prev, { role: 'assistant', senderType: 'system', content: errData.message || 'Failed to send message. Please try again.', createdAt: new Date().toISOString() }]);
        return;
      }
      // Replace temp message with server response
      const savedMsg = await msgRes.json();
      setChatMessages(prev => prev.map(m => m.id === tempId ? { ...userMsg, id: savedMsg.id } : m));

      // Get AI response
      const aiHistory = chatMessages.filter(m => m.senderType === 'student' || m.senderType === 'ai').map(m => ({
        role: m.senderType === 'student' ? 'user' : 'assistant',
        content: m.content,
      }));
      const res = await fetch(`${API_URL}/api/executions/${executionId}/assist`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, conversationHistory: aiHistory }),
      });
      if (res.ok) {
        const data = await res.json();
        const answer = data.answer || 'Sorry, I couldn\'t generate a response.';
        const aiMsg = { role: 'assistant' as const, senderType: 'ai', senderName: 'AI Assistant', content: answer, messageType: 'ai_answer', createdAt: new Date().toISOString() };
        setChatMessages(prev => [...prev, aiMsg]);

        // Save AI response to server thread
        fetch(`${API_URL}/api/executions/${executionId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: answer, messageType: 'ai_answer' }),
        }).catch(() => {});
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', senderType: 'ai', senderName: 'AI Assistant', content: 'Sorry, the assistant is currently unavailable.', createdAt: new Date().toISOString() }]);
      }
    } catch (err) {
      console.error('Chat failed:', err);
      setChatMessages(prev => [...prev, { role: 'assistant', senderType: 'ai', senderName: 'AI Assistant', content: 'Connection error. Try again.', createdAt: new Date().toISOString() }]);
    } finally {
      setAssistantLoading(false);
    }
  }

  async function handleRequestMeeting() {
    try {
      setMeetingLoading(true);
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/executions/${executionId}/request-meeting`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: meetingMessage || undefined }),
      });
      if (res.ok) {
        setMeetingSent(true);
        setMeetingMessage('');
      }
    } catch (err) {
      console.error('Meeting request failed:', err);
    } finally {
      setMeetingLoading(false);
    }
  }

  async function handleClockIn() {
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await clockIn(executionId, token);
      track(EVENTS.TASK_CLOCKED_IN, { executionId });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock in');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleClockOut() {
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await clockOut(executionId, token);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock out');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSubmit() {
    const urls = deliverableUrls.filter(u => u.trim());
    if (urls.length === 0) {
      setError('At least one deliverable URL is required');
      return;
    }
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await submitDeliverables(executionId, { deliverableUrls: urls, submissionNotes }, token);
      setShowSubmitForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setActionLoading(false);
    }
  }

  // Milestone submission state — per milestone
  const [activeMilestoneSubmit, setActiveMilestoneSubmit] = useState<string | null>(null);
  const [milestoneLink, setMilestoneLink] = useState('');
  const [milestoneNotes, setMilestoneNotes] = useState('');
  const [milestoneSubmitting, setMilestoneSubmitting] = useState(false);

  async function handleSubmitMilestone(milestoneId: string) {
    try {
      setMilestoneSubmitting(true);
      const token = await getToken();
      if (!token) return;
      await completeMilestone(executionId, milestoneId, {
        evidenceUrl: milestoneLink.trim() || undefined,
        notes: milestoneNotes.trim() || undefined,
      }, token);
      setActiveMilestoneSubmit(null);
      setMilestoneLink('');
      setMilestoneNotes('');
      await loadData();
    } catch (err) {
      console.error('Failed to submit milestone:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit milestone');
    } finally {
      setMilestoneSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-[#f5f5f8] rounded w-48"></div>
          <div className="h-48 bg-[#f5f5f8] rounded-2xl"></div>
          <div className="h-32 bg-[#f5f5f8] rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <AlertCircle className="w-12 h-12 text-[#e0e0e8] mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-[#1f1f2e]">Execution not found</h2>
      </div>
    );
  }

  const isPending = ['pending_screening', 'pending_review'].includes(execution.status);
  const isActive = ['assigned', 'clocked_in', 'revision_needed'].includes(execution.status);
  const canSubmit = ['assigned', 'clocked_in', 'revision_needed'].includes(execution.status);
  const completedMilestones = execution.milestones?.filter(m => m.completedAt).length || 0;
  const totalMilestones = execution.milestones?.length || 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      <Link
        href="/student/executions"
        className="inline-flex items-center gap-2 text-sm text-[#6b6b80] hover:text-[#1f1f2e] mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to My Work
      </Link>

      {error && (
        <div className="bg-[#f0f0ff] border border-[#e0e0f0] rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-[#a2a3fc] flex-shrink-0" />
          <p className="text-sm text-[#6b6b80]">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-[#a0a0b0] hover:text-[#1f1f2e]">×</button>
        </div>
      )}

      {/* Pending Screening Banner */}
      {(execution.status === 'pending_screening' || (execution.status === 'pending_review' && execution.interviewLink)) && (
        <div className="bg-[#f0f0ff] border border-[#e0e0f0] rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-3 flex-1">
            <AlertCircle className="w-5 h-5 text-[#a2a3fc] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-[#1f1f2e]">Screening Interview Required</p>
              <p className="text-xs text-[#6b6b80] mt-0.5">
                {execution.status === 'pending_screening' 
                  ? 'Complete the screening interview before you can clock in and start working on this task.'
                  : 'Complete the screening interview to proceed with your application.'}
              </p>
            </div>
          </div>
          {execution.interviewLink && (
            <a
              href={execution.interviewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] transition-colors flex-shrink-0"
            >
              <MessageSquare className="w-4 h-4" />
              Start Interview
            </a>
          )}
        </div>
      )}

      {/* Pending Review — full approval waiting page */}
      {execution.status === 'pending_review' && (
        <div className="bg-white rounded-xl border border-[#f0f0f5] p-6 mb-6">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-[#f0f0ff] rounded-full flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6 text-[#a2a3fc]" />
            </div>
            <h2 className="text-lg font-semibold text-[#1f1f2e]">Application Under Review</h2>
            <p className="text-sm text-[#6b6b80] mt-1">
              The company is reviewing your application for this task.
            </p>
          </div>

          <div className="space-y-4">
            {/* Task info */}
            <div className="bg-[#f5f5f8] rounded-lg p-4">
              <h3 className="text-sm font-medium text-[#1f1f2e] mb-2">{execution.workUnit?.title}</h3>
              <div className="flex flex-wrap gap-3 text-xs text-[#6b6b80]">
                <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${((execution.workUnit?.priceInCents || 0) / 100).toFixed(0)}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {execution.workUnit?.deadlineHours || 0}h deadline</span>
              </div>
            </div>

            {/* What was submitted */}
            <div>
              <h4 className="text-xs font-medium text-[#6b6b80] mb-2">What's being reviewed</h4>
              <div className="space-y-1.5 text-xs text-[#6b6b80]">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-[#a2a3fc]" />
                  <span>Your profile and qualifications</span>
                </div>
                {execution.workUnit?.infoCollectionTemplateId && (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-[#a2a3fc]" />
                    <span>Screening interview completed</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-[#a2a3fc]" />
                  <span>Skill match verified</span>
                </div>
              </div>
            </div>

            {/* What to expect */}
            <div>
              <h4 className="text-xs font-medium text-[#6b6b80] mb-2">What happens next</h4>
              <div className="space-y-1.5 text-xs text-[#6b6b80]">
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#f0f0ff] text-[#a2a3fc] flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5">1</span>
                  <span>The company reviews your application and interview transcript</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#f5f5f5] text-[#6b6b80] flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5">2</span>
                  <span>If approved, you'll be assigned and can start working</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#f5f5f5] text-[#6b6b80] flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5">3</span>
                  <span>You'll receive a notification with next steps</span>
                </div>
              </div>
            </div>

            {/* Applied timestamp */}
            <div className="pt-3 border-t border-[#f0f0f5] text-xs text-[#a0a0b0] text-center">
              Applied {new Date(execution.assignedAt || (execution as any).createdAt || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl border border-[#f0f0f5] p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[#1f1f2e]">{execution.workUnit?.title || 'Task'}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-[#6b6b80]">
              <span className="flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5" />
                ${((execution.workUnit?.priceInCents || 0) / 100).toFixed(0)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Due: {new Date(execution.deadlineAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
          <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            execution.status === 'approved' ? 'bg-[#f0f0ff] text-[#a2a3fc]' :
            execution.status === 'clocked_in' ? 'bg-[#f0f0ff] text-[#a2a3fc]' :
            execution.status === 'submitted' ? 'bg-[#f0f0ff] text-[#7b7cee]' :
            execution.status === 'revision_needed' ? 'bg-[#f5f5f5] text-[#6b6b80]' :
            execution.status === 'failed' ? 'bg-[#f5f5f5] text-[#6b6b80]' :
            execution.status === 'pending_screening' ? 'bg-[#f0f0ff] text-[#a2a3fc]' :
            execution.status === 'pending_review' ? 'bg-[#f0f0ff] text-[#7b7cee]' :
            'bg-[#f5f5f5] text-[#6b6b80]'
          }`}>
            {execution.status === 'pending_screening' ? 'Screening Required' :
             execution.status === 'pending_review' ? 'Under Review' :
             execution.status.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Progress Bar */}
        {(() => {
          const stages = [
            { key: 'acceptance', label: 'Accepted', icon: CheckCircle },
            { key: 'working', label: 'Working', icon: Play },
            { key: 'submitted', label: 'Submitted', icon: Upload },
            { key: 'review', label: 'Review', icon: Clock },
            { key: 'approved', label: 'Approved', icon: CheckCircle },
            { key: 'paid', label: 'Paid', icon: DollarSign },
          ];

          const getCurrentStage = () => {
            const status = execution.status;
            const payoutStatus = execution.payoutStatus || 'pending';

            // Payment stage takes precedence
            if (payoutStatus === 'completed') return 'paid';
            if (payoutStatus === 'processing') return 'paid'; // Show as paid when processing
            
            // Approval stage
            if (status === 'approved') return 'approved';
            
            // Review stage (includes pending_review and in_review)
            if (status === 'pending_review' || status === 'in_review') return 'review';
            
            // Submission stage
            if (status === 'submitted') return 'submitted';
            
            // Working stage
            if (status === 'clocked_in') return 'working';
            
            // Acceptance stage (assigned, pending_screening, revision_needed)
            if (['assigned', 'pending_screening', 'revision_needed'].includes(status)) return 'acceptance';
            
            // Default to acceptance
            return 'acceptance';
          };

          const currentStage = getCurrentStage();
          const currentIndex = stages.findIndex(s => s.key === currentStage);

          return (
            <div className="mt-6 pt-6 border-t border-[#f0f0f5]">
              <div className="relative">
                {/* Progress Line */}
                <div className="absolute top-5 left-0 right-0 h-0.5 bg-[#f0f0f5]">
                  <div
                    className="h-full bg-[#a2a3fc] transition-all duration-500 ease-out"
                    style={{
                      width: `${(currentIndex / (stages.length - 1)) * 100}%`,
                    }}
                  />
                </div>

                {/* Stages */}
                <div className="relative flex justify-between">
                  {stages.map((stage, index) => {
                    const StageIcon = stage.icon;
                    const isCompleted = index <= currentIndex;
                    const isCurrent = index === currentIndex;
                    const isPast = index < currentIndex;

                    return (
                      <div key={stage.key} className="flex flex-col items-center flex-1">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                            isCompleted
                              ? 'bg-[#a2a3fc] border-[#a2a3fc] text-white'
                              : 'bg-white border-[#e0e0e8] text-[#a0a0b0]'
                          } ${isCurrent ? 'ring-2 ring-[#a2a3fc] ring-offset-2' : ''}`}
                        >
                          <StageIcon className="w-4 h-4" />
                        </div>
                        <span
                          className={`mt-2 text-xs font-medium text-center ${
                            isCompleted ? 'text-[#1f1f2e]' : 'text-[#a0a0b0]'
                          }`}
                        >
                          {stage.label}
                        </span>
                        {isCurrent && (
                          <span className="mt-1 text-[10px] text-[#a2a3fc] font-medium">
                            Current
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Actions */}
        {isActive && (
          <div className="flex flex-wrap gap-3 pt-4 border-t border-[#f0f0f5]">
            {execution.status === 'assigned' || execution.status === 'revision_needed' ? (
              <button
                onClick={handleClockIn}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] disabled:opacity-50 transition-colors"
              >
                <Play className="w-4 h-4" />
                Clock In
              </button>
            ) : execution.status === 'clocked_in' ? (
              <button
                onClick={handleClockOut}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f5] text-[#1f1f2e] rounded-lg text-sm font-medium hover:bg-[#eaeaec] disabled:opacity-50 transition-colors"
              >
                <Pause className="w-4 h-4" />
                Clock Out
              </button>
            ) : null}

            {canSubmit && (!execution.milestones || execution.milestones.length === 0) && (
              <button
                onClick={() => setShowSubmitForm(!showSubmitForm)}
                className="flex items-center gap-2 px-4 py-2 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] transition-colors"
              >
                <Upload className="w-4 h-4" />
                Submit Deliverables
              </button>
            )}
          </div>
        )}
      </div>

      {/* Submit Form */}
      {showSubmitForm && (
        <div className="bg-white rounded-xl border border-[#e0e0f0] p-6 mb-6">
          <h2 className="font-semibold text-[#1f1f2e] mb-4">Submit Deliverables</h2>
          <div className="space-y-4">
            {deliverableUrls.map((url, i) => (
              <div key={i} className="flex items-center gap-3">
                <input
                  type="url"
                  value={url}
                  onChange={e => {
                    const updated = [...deliverableUrls];
                    updated[i] = e.target.value;
                    setDeliverableUrls(updated);
                  }}
                  placeholder="Deliverable URL (e.g. Google Drive, GitHub)"
                  className="flex-1 px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#a2a3fc]/30 focus:border-[#a2a3fc]"
                />
                {deliverableUrls.length > 1 && (
                  <button
                    onClick={() => setDeliverableUrls(deliverableUrls.filter((_, j) => j !== i))}
                    className="p-2 text-[#a0a0b0] hover:text-[#1f1f2e]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setDeliverableUrls([...deliverableUrls, ''])}
              className="flex items-center gap-1 text-sm text-[#a2a3fc] hover:text-[#7b7cee]"
            >
              <Plus className="w-3.5 h-3.5" />
              Add URL
            </button>
            <div>
              <label className="text-sm font-medium text-[#1f1f2e]">Notes (optional)</label>
              <textarea
                value={submissionNotes}
                onChange={e => setSubmissionNotes(e.target.value)}
                rows={3}
                placeholder="Any notes about your submission..."
                className="w-full mt-1 px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#a2a3fc]/30 focus:border-[#a2a3fc] resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={actionLoading}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] disabled:opacity-50 transition-colors"
              >
                {actionLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Submit
                  </>
                )}
              </button>
              <button
                onClick={() => setShowSubmitForm(false)}
                className="px-4 py-2 text-sm text-[#6b6b80] hover:text-[#1f1f2e]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Milestones — with inline submit forms */}
      {execution.milestones && execution.milestones.length > 0 && (
        <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-[#f0f0f5] flex items-center justify-between">
            <span className="text-sm font-medium text-[#1f1f2e]">Milestones</span>
            <span className="text-xs text-[#a0a0b0]">{completedMilestones}/{totalMilestones}</span>
          </div>
          <div className="divide-y divide-[#f0f0f5]">
            {execution.milestones
              .sort((a, b) => (a.template?.orderIndex ?? a.orderIndex ?? 0) - (b.template?.orderIndex ?? b.orderIndex ?? 0))
              .map(milestone => {
                const desc = milestone.template?.description || milestone.description || 'Milestone';
                const status = (milestone as any).status || (milestone.completedAt ? 'approved' : 'pending');
                const payout = milestone.template?.payoutPercent ? `${milestone.template.payoutPercent}%` : null;
                const revisionNote = (milestone as any).revisionNotes;
                const isDone = status === 'approved';
                const isSubmitted = status === 'submitted';
                const needsRevision = status === 'revision_needed';
                const canSubmitMilestone = !isDone && !isSubmitted && isActive;
                const isExpanded = activeMilestoneSubmit === milestone.id;

                return (
                  <div key={milestone.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isDone ? 'bg-[#a2a3fc]' : isSubmitted ? 'bg-[#f0f0ff] border border-[#a2a3fc]' : needsRevision ? 'bg-[#fff3e0] border border-[#f59e0b]' : 'border border-[#d0d0d8]'
                        }`}>
                          {isDone && <CheckCircle className="w-3 h-3 text-white" />}
                          {isSubmitted && <Clock className="w-2.5 h-2.5 text-[#a2a3fc]" />}
                        </div>
                        <span className={`text-sm truncate ${isDone ? 'text-[#a0a0b0] line-through' : 'text-[#1f1f2e]'}`}>{desc}</span>
                        {payout && <span className="text-[10px] text-[#a0a0b0] flex-shrink-0">{payout}</span>}
                      </div>
                      {canSubmitMilestone && !isExpanded && (
                        <button
                          onClick={() => { setActiveMilestoneSubmit(milestone.id); setMilestoneLink(''); setMilestoneNotes(''); }}
                          className="text-xs text-[#a2a3fc] hover:text-[#7b7cee] font-medium flex-shrink-0 ml-2"
                        >
                          Submit
                        </button>
                      )}
                      {canSubmitMilestone && isExpanded && (
                        <button onClick={() => setActiveMilestoneSubmit(null)} className="text-xs text-[#a0a0b0] hover:text-[#6b6b80] flex-shrink-0 ml-2">Cancel</button>
                      )}
                      {isSubmitted && <span className="text-[10px] text-[#a2a3fc] flex-shrink-0 ml-2">Under review</span>}
                      {needsRevision && !isExpanded && (
                        <button
                          onClick={() => { setActiveMilestoneSubmit(milestone.id); setMilestoneLink(''); setMilestoneNotes(''); }}
                          className="text-xs text-[#f59e0b] hover:text-[#d97706] font-medium flex-shrink-0 ml-2"
                        >
                          Resubmit
                        </button>
                      )}
                    </div>
                    {needsRevision && revisionNote && !isExpanded && (
                      <p className="text-xs text-[#f59e0b] mt-1 ml-8">{revisionNote}</p>
                    )}
                    {/* Inline submit form */}
                    {isExpanded && (
                      <div className="mt-3 ml-8 space-y-2">
                        {needsRevision && revisionNote && (
                          <p className="text-xs text-[#f59e0b] bg-[#fff8e1] rounded px-2 py-1">Feedback: {revisionNote}</p>
                        )}
                        <input
                          type="url"
                          value={milestoneLink}
                          onChange={e => setMilestoneLink(e.target.value)}
                          placeholder="Deliverable link (Google Drive, GitHub, etc.)"
                          className="w-full px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm focus:outline-none focus:border-[#a2a3fc]"
                        />
                        <textarea
                          value={milestoneNotes}
                          onChange={e => setMilestoneNotes(e.target.value)}
                          rows={2}
                          placeholder="Notes (optional)"
                          className="w-full px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm focus:outline-none focus:border-[#a2a3fc] resize-none"
                        />
                        <button
                          onClick={() => handleSubmitMilestone(milestone.id)}
                          disabled={milestoneSubmitting}
                          className="px-4 py-1.5 bg-[#a2a3fc] text-white rounded-lg text-xs font-medium hover:bg-[#8b8cf0] disabled:opacity-50"
                        >
                          {milestoneSubmitting ? 'Submitting...' : 'Submit milestone'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Revision History */}
      {revisions.length > 0 && (
        <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#f0f0f5]">
            <h2 className="font-semibold text-[#1f1f2e] flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Revision History ({revisions.length})
            </h2>
          </div>
          <div className="divide-y divide-[#f0f0f5]">
            {revisions.map((rev, i) => (
              <div key={rev.id || i} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[#1f1f2e]">
                    Revision #{rev.revisionNumber || i + 1}
                  </span>
                  <span className="text-xs text-[#a0a0b0]">
                    {new Date(rev.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {rev.overallFeedback && (
                  <p className="text-sm text-[#6b6b80]">{rev.overallFeedback}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QA Preview + AI Assistant */}
      {isActive && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* QA Preview */}
          <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#f0f0f5] flex items-center justify-between">
              <h2 className="font-semibold text-[#1f1f2e] flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#a2a3fc]" />
                QA Pre-Check
              </h2>
              <button
                onClick={handleQAPreview}
                disabled={qaLoading || deliverableUrls.filter(u => u.trim()).length === 0}
                className="px-3 py-1.5 bg-[#f0f0ff] text-[#a2a3fc] rounded-lg text-xs font-medium hover:bg-[#e8e8ff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={deliverableUrls.filter(u => u.trim()).length === 0 ? 'Add deliverable URLs first' : 'Run QA check'}
              >
                {qaLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Run Check'}
              </button>
            </div>
            <div className="p-6">
              {!qaPreview ? (
                <div className="space-y-2">
                  <p className="text-sm text-[#6b6b80]">
                    Run a pre-submission quality check to catch issues before submitting your work.
                  </p>
                  {deliverableUrls.filter(u => u.trim()).length === 0 && (
                    <p className="text-xs text-[#a0a0b0] italic">
                      Add deliverable URLs in the submission form above to run QA check.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-[#a2a3fc] font-medium">✓ {qaPreview.checksPassed || 0} passed</span>
                    {qaPreview.checksWarning > 0 && (
                      <span className="text-[#6b6b80] font-medium">⚠ {qaPreview.checksWarning} warnings</span>
                    )}
                    {qaPreview.checksFailed > 0 && (
                      <span className="text-[#1f1f2e] font-medium">✕ {qaPreview.checksFailed} blockers</span>
                    )}
                  </div>
                  {/* Message */}
                  {qaPreview.message && (
                    <p className={cn('text-sm font-medium', qaPreview.blockers?.length === 0 ? 'text-[#a2a3fc]' : 'text-[#1f1f2e]')}>
                      {qaPreview.message}
                    </p>
                  )}
                  {/* Blockers */}
                  {qaPreview.blockers?.length > 0 && (
                    <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                      <p className="text-xs font-medium text-red-700 mb-1">Blockers:</p>
                      <ul className="text-xs text-red-600 space-y-1">
                        {qaPreview.blockers.map((b: string, i: number) => (
                          <li key={i}>• {b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Warnings */}
                  {qaPreview.warnings?.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3">
                      <p className="text-xs font-medium text-yellow-700 mb-1">Warnings:</p>
                      <ul className="text-xs text-yellow-600 space-y-1">
                        {qaPreview.warnings.map((w: string, i: number) => (
                          <li key={i}>• {w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Chat + Meeting Request */}
          <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden">
            <div className="px-6 py-3 border-b border-[#f0f0f5] flex items-center gap-1">
              <button
                onClick={() => setChatTab('chat')}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', chatTab === 'chat' ? 'bg-[#a2a3fc] text-white' : 'text-[#6b6b80] hover:bg-[#f5f5f8]')}
              >
                <MessageSquare className="w-3.5 h-3.5 inline mr-1" />
                Chat
                {unreadCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[10px]">{unreadCount}</span>}
              </button>
              <button
                onClick={() => setChatTab('meeting')}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', chatTab === 'meeting' ? 'bg-[#1f1f2e] text-white' : 'text-[#6b6b80] hover:bg-[#f5f5f8]')}
              >
                {meetingSent ? '✓ Meeting Sent' : 'Request Meeting'}
              </button>
            </div>

            {chatTab === 'chat' ? (
              <div className="flex flex-col" style={{ maxHeight: '520px' }}>
                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ minHeight: '240px', maxHeight: '400px' }}>
                  {chatMessages.length === 0 && (
                    <div className="text-center py-8">
                      <MessageSquare className="w-8 h-8 text-[#e0e0f0] mx-auto mb-3" />
                      <p className="text-sm text-[#6b6b80]">Ask the AI about this task, or message the client directly.</p>
                      <p className="text-xs text-[#a0a0b0] mt-1">AI knows the task spec, company info, and onboarding page.</p>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => {
                    const isMe = msg.senderType === 'student';
                    const isClient = msg.senderType === 'company';
                    const isAI = msg.senderType === 'ai';
                    const isSystem = msg.senderType === 'system';

                    if (isSystem) {
                      return (
                        <div key={i} className="text-center">
                          <span className="text-[10px] text-[#a0a0b0] bg-[#fafaff] px-3 py-1 rounded-full">{msg.content}</span>
                        </div>
                      );
                    }

                    const attachments = (msg as any).attachments && Array.isArray((msg as any).attachments) ? (msg as any).attachments : [];
                    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const isRead = (msg as any).readAt && !isMe;
                    return (
                      <div key={msg.id || i} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                        <div className="max-w-[85%]">
                          {!isMe && (
                            <p className={cn('text-[10px] font-medium mb-0.5 ml-1', isClient ? 'text-[#1f1f2e]' : 'text-[#a2a3fc]')}>
                              {isClient ? `${msg.senderName || 'Client'}` : 'AI Assistant'}
                            </p>
                          )}
                          <div className={cn(
                            'rounded-xl px-4 py-2.5 text-sm',
                            isMe ? 'bg-[#a2a3fc] text-white rounded-br-sm'
                              : isClient ? 'bg-[#1f1f2e] text-white rounded-bl-sm'
                              : 'bg-[#f5f5f8] text-[#1f1f2e] rounded-bl-sm'
                          )}>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                            {attachments.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {attachments.map((att: any, ai: number) => (
                                  <a key={ai} href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[10px] opacity-80 hover:opacity-100 underline">
                                    <Paperclip className="w-3 h-3" />
                                    <span className="truncate">{att.filename || 'Attachment'}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                          {time && (
                            <div className={cn('flex items-center gap-1 text-[10px] mt-0.5', isMe ? 'justify-end' : 'justify-start')}>
                              <span className="text-[#a0a0b0]">{time}</span>
                              {isMe && isRead && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {assistantLoading && (
                    <div className="flex justify-start">
                      <div className="bg-[#f5f5f8] rounded-xl px-4 py-2.5 rounded-bl-sm">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#a2a3fc] animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#a2a3fc] animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#a2a3fc] animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Attachments preview */}
                {chatAttachments.length > 0 && (
                  <div className="px-3 pt-2 flex flex-wrap gap-1.5">
                    {chatAttachments.map((att, idx) => (
                      <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-[#f5f5f8] rounded text-[10px]">
                        <Paperclip className="w-3 h-3 text-[#6b6b80]" />
                        <span className="text-[#1f1f2e] truncate max-w-[100px]">{att.filename}</span>
                        <button type="button" onClick={() => setChatAttachments(prev => prev.filter((_, i) => i !== idx))} className="text-[#a0a0b0] hover:text-[#6b6b80]">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Input */}
                <form onSubmit={handleSendMessage} className="p-3 border-t border-[#f0f0f5] flex gap-2">
                  <input type="file" id="chat-file" className="hidden" multiple onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length === 0) return;
                    setChatUploading(true);
                    try {
                      const token = await getToken();
                      if (!token) return;
                      const uploads = await Promise.all(files.map(async (file) => {
                        const formData = new FormData();
                        formData.append('file', file);
                        const uploadRes = await fetch(`${API_URL}/api/agent/upload-onboarding-file`, {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}` },
                          body: formData,
                        });
                        if (uploadRes.ok) {
                          const data = await uploadRes.json();
                          return { url: data.url, filename: data.filename || file.name, mimetype: data.mimetype || file.type, size: data.size || file.size };
                        }
                        throw new Error('Upload failed');
                      }));
                      setChatAttachments(prev => [...prev, ...uploads]);
                    } catch (err) {
                      alert('Failed to upload file(s). Please try again.');
                    } finally {
                      setChatUploading(false);
                      (e.target as HTMLInputElement).value = '';
                    }
                  }} />
                  <label htmlFor="chat-file" className="px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm hover:bg-[#f5f5f8] cursor-pointer flex items-center">
                    {chatUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                  </label>
                  <input
                    value={assistantQuestion}
                    onChange={e => {
                      if (e.target.value.length <= 10000) setAssistantQuestion(e.target.value);
                    }}
                    maxLength={10000}
                    className="flex-1 px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#a2a3fc]/30 focus:border-[#a2a3fc]"
                    placeholder="Ask AI or message client..."
                    disabled={assistantLoading}
                  />
                  <button
                    type="submit"
                    disabled={assistantLoading || (assistantQuestion.length < 3 && chatAttachments.length === 0)}
                    className="px-3 py-2 bg-[#a2a3fc] text-white rounded-lg text-sm hover:bg-[#8b8cf0] transition-colors disabled:opacity-50"
                  >
                    {assistantLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </form>
                <p className="px-3 pb-2 text-[10px] text-[#a0a0b0] italic">AI guidance only. Client messages appear in dark. Your messages saved to thread.</p>
              </div>
            ) : (
              /* Meeting Request Panel */
              <div className="p-6 space-y-4">
                <p className="text-sm text-[#6b6b80]">
                  Need to discuss something directly with the client? Send a meeting request and they&apos;ll be notified via email.
                </p>
                {!meetingSent ? (
                  <>
                    <textarea
                      value={meetingMessage}
                      onChange={e => setMeetingMessage(e.target.value)}
                      className="w-full px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-[#a2a3fc]/30 focus:border-[#a2a3fc]"
                      placeholder="What do you want to discuss? (e.g. 'I need clarification on the brand colors for concept #3')"
                    />
                    <button
                      onClick={handleRequestMeeting}
                      disabled={meetingLoading}
                      className="w-full py-2.5 bg-[#1f1f2e] text-white rounded-lg text-sm font-medium hover:bg-[#2f2f3e] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {meetingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                      Send Meeting Request
                    </button>
                  </>
                ) : (
                  <div className="bg-green-50 border border-green-100 rounded-lg p-4 text-center">
                    <CheckCircle className="w-6 h-6 text-green-500 mx-auto mb-2" />
                    <p className="text-sm font-medium text-green-800">Meeting request sent!</p>
                    <p className="text-xs text-green-600 mt-1">The client has been notified. They&apos;ll reach out to schedule.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result */}
      {execution.status === 'approved' && (
        <div className="bg-[#f0f0ff] border border-[#e0e0f0] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle className="w-6 h-6 text-[#a2a3fc]" />
            <h2 className="text-lg font-semibold text-[#1f1f2e]">Task Approved!</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {execution.qualityScore != null && (
              <div>
                <span className="text-[#a2a3fc]">Quality Score:</span>{' '}
                <span className="font-semibold">{execution.qualityScore}%</span>
              </div>
            )}
            {execution.expEarned > 0 && (
              <div>
                <span className="text-[#a2a3fc]">EXP Earned:</span>{' '}
                <span className="font-semibold">+{execution.expEarned}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
