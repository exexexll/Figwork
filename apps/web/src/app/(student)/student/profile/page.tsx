'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  User,
  FileText,
  Upload,
  Trash2,
  Plus,
  CheckCircle,
  Clock,
  AlertCircle,
  Star,
  Zap,
  Award,
  Shield,
  CreditCard,
  FileSignature,
  Save,
} from 'lucide-react';
import {
  getStudentProfile,
  updateStudentProfile,
  getStudentFiles,
  deleteStudentFile,
  StudentProfile,
  StudentFile,
} from '@/lib/marketplace-api';

const ONBOARDING_STEPS = [
  { key: 'phoneVerifiedAt', label: 'Phone Verified', icon: Shield },
  { key: 'kycStatus', label: 'Identity (KYC)', icon: Shield, statusField: true },
  { key: 'taxStatus', label: 'Tax Information', icon: FileText, statusField: true },
  { key: 'contractStatus', label: 'Contract Signed', icon: FileSignature, statusField: true },
  { key: 'stripeConnectStatus', label: 'Stripe Connect', icon: CreditCard, statusField: true },
];

export default function ProfilePage() {
  const { getToken } = useAuth();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [files, setFiles] = useState<StudentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  
  // Editable fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const [profileData, filesData] = await Promise.all([
        getStudentProfile(token),
        getStudentFiles(token),
      ]);
      setProfile(profileData);
      setFiles(filesData);
      setName(profileData.name);
      setPhone(profileData.phone || '');
      setSkills(profileData.skillTags || []);
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      const token = await getToken();
      if (!token) return;
      const updated = await updateStudentProfile({ name, phone, skillTags: skills }, token);
      setProfile(updated);
      setEditMode(false);
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setSaving(false);
    }
  }

  function addSkill() {
    const trimmed = skillInput.trim().toLowerCase();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
      setSkillInput('');
    }
  }

  function removeSkill(skill: string) {
    setSkills(skills.filter(s => s !== skill));
  }

  async function handleDeleteFile(fileId: string) {
    try {
      const token = await getToken();
      if (!token) return;
      await deleteStudentFile(fileId, token);
      setFiles(files.filter(f => f.id !== fileId));
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-48 bg-slate-200 rounded-2xl"></div>
          <div className="h-32 bg-slate-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const TierIcon = profile.tier === 'elite' ? Award : profile.tier === 'pro' ? Zap : Star;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Profile & Files</h1>
        <p className="text-slate-500 mt-1">Manage your profile, skills, and uploaded documents</p>
      </div>

      {/* Profile Card */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Profile Information</h2>
          {!editMode ? (
            <button
              onClick={() => setEditMode(true)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => { setEditMode(false); setName(profile.name); setSkills(profile.skillTags); }}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
        
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-600">Name</label>
              {editMode ? (
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <div className="mt-1 text-slate-900">{profile.name}</div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Email</label>
              <div className="mt-1 text-slate-900">{profile.email}</div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Phone</label>
              {editMode ? (
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <div className="mt-1 text-slate-900">{profile.phone || 'Not set'}</div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Tier</label>
              <div className="flex items-center gap-2 mt-1">
                <TierIcon className="w-4 h-4" />
                <span className="capitalize font-medium">{profile.tier}</span>
                <span className="text-sm text-slate-500">({profile.totalExp.toLocaleString()} EXP)</span>
              </div>
            </div>
          </div>

          {/* Skills */}
          <div>
            <label className="text-sm font-medium text-slate-600">Skills</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {skills.map(skill => (
                <span key={skill} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-sm">
                  {skill}
                  {editMode && (
                    <button onClick={() => removeSkill(skill)} className="ml-1 text-blue-500 hover:text-blue-700">
                      ×
                    </button>
                  )}
                </span>
              ))}
              {editMode && (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={skillInput}
                    onChange={e => setSkillInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSkill())}
                    placeholder="Add skill..."
                    className="px-3 py-1 border border-slate-200 rounded-lg text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button onClick={addSkill} className="p-1 text-blue-600 hover:text-blue-700">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Status */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Onboarding Status</h2>
        </div>
        <div className="p-6">
          <div className="space-y-3">
            {ONBOARDING_STEPS.map(step => {
              const StepIcon = step.icon;
              let status: string;
              if (step.statusField) {
                status = (profile as any)[step.key] || 'pending';
              } else {
                status = (profile as any)[step.key] ? 'verified' : 'pending';
              }
              const isComplete = status === 'verified' || status === 'signed' || status === 'active' || status === 'completed';
              
              return (
                <div key={step.key} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isComplete ? 'bg-green-100' : 'bg-slate-100'
                    }`}>
                      {isComplete ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <StepIcon className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <span className={`text-sm ${isComplete ? 'text-slate-900' : 'text-slate-500'}`}>
                      {step.label}
                    </span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    isComplete ? 'bg-green-100 text-green-700' :
                    status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Uploaded Files */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">My Files</h2>
        </div>

        {/* Upload Area */}
        <div className="p-6 border-b border-slate-100">
          <div
            className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-[#c4b5fd] transition-colors cursor-pointer"
            onClick={() => document.getElementById('profile-file-upload')?.click()}
          >
            <Upload className="w-8 h-8 text-[#a78bfa] mx-auto mb-2" />
            <p className="text-sm text-slate-600">
              Drop files here or <span className="text-[#a78bfa] font-medium">browse</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">Resume, portfolio, certificates (PDF, DOC, images)</p>
            <input
              id="profile-file-upload"
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange={async (e) => {
                const selectedFiles = Array.from(e.target.files || []);
                if (selectedFiles.length === 0) return;
                try {
                  const token = await getToken();
                  if (!token) return;
                  const { uploadStudentFile } = await import('@/lib/marketplace-api');
                  for (const file of selectedFiles) {
                    const category = file.name.toLowerCase().includes('resume') ? 'resume' 
                      : file.name.toLowerCase().includes('cert') ? 'certificate' 
                      : 'portfolio';
                    await uploadStudentFile({ filename: file.name, fileType: file.type, category }, token);
                  }
                  loadData();
                } catch (err) {
                  console.error('Upload failed:', err);
                }
              }}
            />
          </div>
        </div>
        
        {files.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No files uploaded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {files.map(file => (
              <div key={file.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-slate-400" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">{file.filename}</div>
                    <div className="text-xs text-slate-500">
                      {file.category} · {new Date(file.uploadedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {file.cloudinaryUrl && (
                    <a
                      href={file.cloudinaryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#a78bfa] hover:text-[#8b5cf6] font-medium"
                    >
                      View
                    </a>
                  )}
                  <button
                    onClick={() => handleDeleteFile(file.id)}
                    className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Performance Stats</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-slate-900">{profile.tasksCompleted}</div>
            <div className="text-xs text-slate-500">Tasks Done</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-slate-900">
              {(profile.avgQualityScore * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-500">Avg Quality</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-slate-900">
              {(profile.onTimeRate * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-500">On-Time Rate</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              {profile.totalExp.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500">Total EXP</div>
          </div>
        </div>
      </div>
    </div>
  );
}
