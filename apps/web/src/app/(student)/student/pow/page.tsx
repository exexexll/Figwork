'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  Camera,
  Clock,
  CheckCircle,
  AlertCircle,
  X,
  Upload,
  Image as ImageIcon,
  Send,
  RefreshCw,
  User,
} from 'lucide-react';
import { getPendingPOW, submitPOW, getPOWHistory, POWLog } from '@/lib/marketplace-api';
import { track, EVENTS } from '@/lib/analytics';

const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_UPLOAD_PRESET = 'figwork_pow';

interface PhotoCapture {
  file: File | null;
  preview: string | null;
  uploading: boolean;
  url: string | null;
  error: string | null;
}

const initialCapture: PhotoCapture = {
  file: null,
  preview: null,
  uploading: false,
  url: null,
  error: null,
};

async function uploadToCloudinary(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', 'pow');

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );

  if (!res.ok) throw new Error('Upload failed');
  const data = await res.json();
  return data.secure_url;
}

function PhotoPicker({
  label,
  description,
  icon: Icon,
  capture,
  onCapture,
  accept,
}: {
  label: string;
  description: string;
  icon: typeof Camera;
  capture: PhotoCapture;
  onCapture: (file: File) => void;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return;
    }
    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return;
    }
    onCapture(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }

  return (
    <div>
      <label className="text-sm font-medium text-[#1f1f2e] mb-1.5 block">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept={accept || 'image/*'}
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {capture.preview ? (
        <div className="relative rounded-xl overflow-hidden border border-[#e8e4f0] bg-white">
          <img
            src={capture.preview}
            alt={label}
            className="w-full h-48 object-cover"
          />
          {capture.uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="flex items-center gap-2 text-white text-sm font-medium">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Uploading...
              </div>
            </div>
          )}
          {capture.url && (
            <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded-full">
              <CheckCircle className="w-3.5 h-3.5" />
            </div>
          )}
          {capture.error && (
            <div className="absolute bottom-0 left-0 right-0 bg-red-500/90 text-white text-xs px-3 py-1.5">
              {capture.error}
            </div>
          )}
          {!capture.uploading && (
            <button
              onClick={() => inputRef.current?.click()}
              className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm text-[#6b6b80] px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-white transition-colors"
            >
              Retake
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full h-48 rounded-xl border-2 border-dashed border-[#e8e4f0] bg-[#faf8fc] hover:border-[#c4b5fd] hover:bg-[#f3f0f8] transition-all flex flex-col items-center justify-center gap-3 group"
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform"
            style={{ background: 'var(--gradient-fig-subtle)' }}
          >
            <Icon className="w-6 h-6 text-[#a78bfa]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[#1f1f2e]">
              Tap to take photo or choose file
            </p>
            <p className="text-xs text-[#a0a0b0] mt-0.5">{description}</p>
          </div>
        </button>
      )}
    </div>
  );
}

export default function POWPage() {
  const { getToken } = useAuth();
  const [pending, setPending] = useState<POWLog[]>([]);
  const [history, setHistory] = useState<POWLog[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');

  // Photo states
  const [activeSubmit, setActiveSubmit] = useState<string | null>(null);
  const [workPhoto, setWorkPhoto] = useState<PhotoCapture>(initialCapture);
  const [selfiePhoto, setSelfiePhoto] = useState<PhotoCapture>(initialCapture);
  const [progressDescription, setProgressDescription] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const [pendingData, historyData] = await Promise.all([
        getPendingPOW(token),
        getPOWHistory(token),
      ]);
      setPending(Array.isArray(pendingData) ? pendingData : []);
      setHistory(Array.isArray(historyData?.logs) ? historyData.logs : []);
      setStats(historyData.stats);
    } catch (err) {
      console.error('Failed to load POW data:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleWorkPhotoCapture = useCallback(async (file: File) => {
    const preview = URL.createObjectURL(file);
    setWorkPhoto({ file, preview, uploading: true, url: null, error: null });

    try {
      const url = await uploadToCloudinary(file);
      setWorkPhoto(prev => ({ ...prev, uploading: false, url }));
    } catch {
      setWorkPhoto(prev => ({
        ...prev,
        uploading: false,
        error: 'Upload failed. Please try again.',
      }));
    }
  }, []);

  const handleSelfieCapture = useCallback(async (file: File) => {
    const preview = URL.createObjectURL(file);
    setSelfiePhoto({ file, preview, uploading: true, url: null, error: null });

    try {
      const url = await uploadToCloudinary(file);
      setSelfiePhoto(prev => ({ ...prev, uploading: false, url }));
    } catch {
      setSelfiePhoto(prev => ({
        ...prev,
        uploading: false,
        error: 'Upload failed. Please try again.',
      }));
    }
  }, []);

  async function handleSubmit(powId: string) {
    if (!workPhoto.url || !selfiePhoto.url) return;

    try {
      setSubmitting(powId);
      const token = await getToken();
      if (!token) return;
      await submitPOW(
        powId,
        {
          workPhotoUrl: workPhoto.url,
          selfiePhotoUrl: selfiePhoto.url,
          progressDescription,
        },
        token
      );
      track(EVENTS.POW_SUBMITTED, { powId });
      resetSubmission();
      await loadData();
    } catch (err) {
      console.error('Failed to submit POW:', err);
    } finally {
      setSubmitting(null);
    }
  }

  function resetSubmission() {
    setActiveSubmit(null);
    setWorkPhoto(initialCapture);
    setSelfiePhoto(initialCapture);
    setProgressDescription('');
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-48"></div>
          <div className="h-24 bg-slate-200 rounded-xl"></div>
          <div className="h-24 bg-slate-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1f1f2e]">Proof of Work</h1>
        <p className="text-[#6b6b80] mt-1">
          Submit verification photos during active work sessions
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Pending', value: stats.pending || 0, color: 'text-amber-600' },
          { label: 'Verified', value: stats.verified || 0, color: 'text-green-600' },
          { label: 'Submitted', value: stats.submitted || 0, color: 'text-blue-600' },
          { label: 'Failed', value: stats.failed || 0, color: 'text-red-600' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white border border-[#e8e4f0] rounded-xl p-3 text-center"
          >
            <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-[#a0a0b0]">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('pending')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            tab === 'pending'
              ? 'text-white'
              : 'bg-white border border-[#e8e4f0] text-[#6b6b80] hover:border-[#c4b5fd]'
          }`}
          style={tab === 'pending' ? { background: 'var(--gradient-fig)' } : {}}
        >
          Pending ({pending.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            tab === 'history'
              ? 'text-white'
              : 'bg-white border border-[#e8e4f0] text-[#6b6b80] hover:border-[#c4b5fd]'
          }`}
          style={tab === 'history' ? { background: 'var(--gradient-fig)' } : {}}
        >
          History
        </button>
      </div>

      {tab === 'pending' && (
        <>
          {pending.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#e8e4f0] p-12 text-center">
              <div
                className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ background: 'var(--gradient-fig-subtle)' }}
              >
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-lg font-semibold text-[#1f1f2e]">All caught up!</h3>
              <p className="text-[#6b6b80] mt-1 text-sm">
                No pending POW checks right now. Keep up the good work.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((pow) => (
                <div
                  key={pow.id}
                  className="bg-white rounded-2xl border border-[#e8e4f0] overflow-hidden hover:border-[#c4b5fd] transition-colors"
                >
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-semibold text-[#1f1f2e]">
                          {pow.execution?.workUnit?.title || 'Task'}
                        </div>
                        <div className="text-sm text-[#a0a0b0] flex items-center gap-2 mt-1">
                          <Clock className="w-3.5 h-3.5" />
                          Requested: {new Date(pow.requestedAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-medium border border-amber-200">
                        Pending
                      </span>
                    </div>

                    {activeSubmit === pow.id ? (
                      <div className="space-y-5 mt-4 pt-4 border-t border-[#e8e4f0]">
                        {/* Photo captures */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <PhotoPicker
                            label="Work Photo"
                            description="Show your current work in progress"
                            icon={Camera}
                            capture={workPhoto}
                            onCapture={handleWorkPhotoCapture}
                          />
                          <PhotoPicker
                            label="Selfie"
                            description="For identity verification"
                            icon={User}
                            capture={selfiePhoto}
                            onCapture={handleSelfieCapture}
                            accept="image/*"
                          />
                        </div>

                        {/* Progress description */}
                        <div>
                          <label className="text-sm font-medium text-[#1f1f2e] mb-1.5 block">
                            Progress Description{' '}
                            <span className="text-[#a0a0b0] font-normal">(optional)</span>
                          </label>
                          <textarea
                            value={progressDescription}
                            onChange={(e) => setProgressDescription(e.target.value)}
                            placeholder="What are you working on right now?"
                            rows={2}
                            className="w-full px-4 py-3 border border-[#e8e4f0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 focus:border-[#c4b5fd] resize-none bg-[#faf8fc]"
                          />
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleSubmit(pow.id)}
                            disabled={
                              !workPhoto.url ||
                              !selfiePhoto.url ||
                              workPhoto.uploading ||
                              selfiePhoto.uploading ||
                              submitting === pow.id
                            }
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-50 transition-all hover:opacity-90"
                            style={{ background: 'var(--gradient-fig)' }}
                          >
                            {submitting === pow.id ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Submitting...
                              </>
                            ) : (
                              <>
                                <Send className="w-4 h-4" />
                                Submit POW
                              </>
                            )}
                          </button>
                          <button
                            onClick={resetSubmission}
                            className="px-4 py-2.5 border border-[#e8e4f0] text-[#6b6b80] rounded-xl text-sm font-medium hover:border-[#c4b5fd] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setActiveSubmit(pow.id);
                          setWorkPhoto(initialCapture);
                          setSelfiePhoto(initialCapture);
                          setProgressDescription('');
                        }}
                        className="flex items-center gap-2 mt-3 px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:opacity-90"
                        style={{ background: 'var(--gradient-fig)' }}
                      >
                        <Camera className="w-4 h-4" />
                        Submit Verification
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-2xl border border-[#e8e4f0] overflow-hidden">
          {history.length === 0 ? (
            <div className="p-12 text-center">
              <div
                className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ background: 'var(--gradient-fig-subtle)' }}
              >
                <Camera className="w-7 h-7 text-[#a78bfa]" />
              </div>
              <h3 className="text-base font-semibold text-[#1f1f2e]">No POW history yet</h3>
              <p className="text-[#a0a0b0] text-sm mt-1">
                Your verification history will appear here
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#e8e4f0]">
              {history.map((pow) => (
                <div
                  key={pow.id}
                  className="px-6 py-4 flex items-center justify-between"
                >
                  <div>
                    <div className="text-sm font-medium text-[#1f1f2e]">
                      {pow.execution?.workUnit?.title || 'Task'}
                    </div>
                    <div className="text-xs text-[#a0a0b0] mt-1">
                      {new Date(pow.requestedAt).toLocaleString()}
                      {pow.respondedAt &&
                        ` · Responded: ${new Date(pow.respondedAt).toLocaleTimeString()}`}
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      pow.status === 'verified'
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : pow.status === 'submitted'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : pow.status === 'failed'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : pow.status === 'expired'
                              ? 'bg-slate-100 text-slate-500'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {pow.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
