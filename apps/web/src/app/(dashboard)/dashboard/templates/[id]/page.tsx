'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  GripVertical,
  Trash2,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Upload,
  Loader2,
  Settings,
  Volume2,
  Play,
  Pause,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  getTemplate,
  updateTemplate,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  createLink,
  revokeLink,
  uploadKnowledge,
  confirmKnowledgeUpload,
  deleteKnowledgeFile,
} from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { AIGenerateButton } from '@/components/ui/ai-generate-button';
import type { Template, InterviewLink, KnowledgeFile, Question, OpenAIVoice, TemplateMode } from '@/lib/types';
import { VOICE_OPTIONS } from '@/lib/types';

// Reusable toggle button for settings
function ToggleBtn({ 
  selected, 
  onClick, 
  children 
}: { 
  selected: boolean; 
  onClick: () => void; 
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-2 text-sm rounded border transition-all',
        selected
          ? 'border-text-primary bg-text-primary text-white'
          : 'border-border text-text-secondary hover:border-text-muted'
      )}
    >
      {children}
    </button>
  );
}

// Sortable Question Item Component
function SortableQuestionItem({
  question,
  index,
  onDelete,
}: {
  question: Question;
  index: number;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <Card ref={setNodeRef} style={style} className="group">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-2 text-text-muted pt-1">
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing touch-none"
            >
              <GripVertical className="w-4 h-4 opacity-50 group-hover:opacity-100" />
            </button>
            <span className="text-sm font-medium w-6">{index + 1}.</span>
          </div>
          <div className="flex-1">
            <p className="text-text-primary font-medium">{question.questionText}</p>
            {question.rubric && (
              <p className="text-sm text-text-secondary mt-1">
                <span className="font-medium">Rubric:</span> {question.rubric}
              </p>
            )}
          </div>
          <button
            onClick={() => onDelete(question.id)}
            className="p-2 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'questions' | 'links' | 'knowledge' | 'settings'>('questions');

  // Question form state
  const [newQuestion, setNewQuestion] = useState('');
  const [newRubric, setNewRubric] = useState('');
  const [addingQuestion, setAddingQuestion] = useState(false);

  // Link form state
  const [linkType, setLinkType] = useState<'permanent' | 'one_time'>('permanent');
  const [allowFileUpload, setAllowFileUpload] = useState(false);
  const [maxFiles, setMaxFiles] = useState(3);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(10);
  const [linkEnableVoice, setLinkEnableVoice] = useState<boolean | null>(null); // null = inherit from template
  const [creatingLink, setCreatingLink] = useState(false);

  // Knowledge upload state
  const [uploadingKnowledge, setUploadingKnowledge] = useState(false);

  // Mode and inquiry settings state
  const [templateMode, setTemplateMode] = useState<'application' | 'inquiry'>('application');
  const [inquiryWelcome, setInquiryWelcome] = useState('');
  const [inquiryGoal, setInquiryGoal] = useState('');

  // Voice settings state
  const [enableVoiceOutput, setEnableVoiceOutput] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<OpenAIVoice>('nova');
  const [voiceIntroMessage, setVoiceIntroMessage] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<OpenAIVoice | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchTemplate();
    return () => {
      // Cleanup audio element on unmount
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
    };
  }, [id]);

  async function fetchTemplate() {
    try {
      const token = await getToken();
      if (!token) return;

      const res = await getTemplate(id, token);
      setTemplate(res.data);
      // Initialize settings from template
      if (res.data) {
        // Mode and inquiry settings
        setTemplateMode(res.data.mode ?? 'application');
        setInquiryWelcome(res.data.inquiryWelcome ?? '');
        setInquiryGoal(res.data.inquiryGoal ?? '');
        // Voice settings
        setEnableVoiceOutput(res.data.enableVoiceOutput ?? false);
        setSelectedVoice(res.data.voiceId ?? 'nova');
        setVoiceIntroMessage(res.data.voiceIntroMessage ?? '');
      }
    } catch (error) {
      console.error('Failed to fetch template:', error);
      toast.error('Failed to load template');
    } finally {
      setLoading(false);
    }
  }

  const handleAddQuestion = async () => {
    if (!newQuestion.trim()) return;
    setAddingQuestion(true);

    try {
      const token = await getToken();
      if (!token) return;

      await addQuestion(
        id,
        {
          questionText: newQuestion,
          rubric: newRubric || undefined,
        },
        token
      );

      setNewQuestion('');
      setNewRubric('');
      toast.success('Question added');
      fetchTemplate();
    } catch (error) {
      toast.error('Failed to add question');
    } finally {
      setAddingQuestion(false);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    try {
      const token = await getToken();
      if (!token) return;

      await deleteQuestion(questionId, token);
      toast.success('Question deleted');
      fetchTemplate();
    } catch (error) {
      toast.error('Failed to delete question');
    }
  };

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id && template?.questions) {
      const oldIndex = template.questions.findIndex((q) => q.id === active.id);
      const newIndex = template.questions.findIndex((q) => q.id === over.id);

      // Optimistically update the UI
      const newQuestions = arrayMove(template.questions, oldIndex, newIndex);
      setTemplate({ ...template, questions: newQuestions });

      // Persist to backend
      try {
        const token = await getToken();
        if (!token) return;

        await reorderQuestions(
          id,
          newQuestions.map((q) => q.id),
          token
        );
        toast.success('Questions reordered');
      } catch (error) {
        // Revert on error
        toast.error('Failed to reorder questions');
        fetchTemplate();
      }
    }
  };

  const handleCreateLink = async () => {
    setCreatingLink(true);

    try {
      const token = await getToken();
      if (!token) return;

      await createLink(
        id,
        {
          linkType,
          allowFileUpload,
          maxFiles,
          maxFileSizeMb,
          allowedFileTypes: ['pdf', 'docx', 'txt', 'md'],
          // Only include voice setting if explicitly set (not null/inherit)
          ...(linkEnableVoice !== null && { enableVoiceOutput: linkEnableVoice }),
        },
        token
      );

      toast.success('Application link created');
      // Reset link form
      setLinkEnableVoice(null);
      setAllowFileUpload(false);
      fetchTemplate();
    } catch (error) {
      toast.error('Failed to create link');
    } finally {
      setCreatingLink(false);
    }
  };

  const handleRevokeLink = async (linkId: string) => {
    try {
      const token = await getToken();
      if (!token) return;

      await revokeLink(linkId, token);
      toast.success('Link revoked');
      fetchTemplate();
    } catch (error) {
      toast.error('Failed to revoke link');
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  };

  const handleKnowledgeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['pdf', 'docx', 'txt', 'md'].includes(ext)) {
      toast.error('Only PDF, DOCX, TXT, and MD files are allowed');
      return;
    }

    // Validate file size
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be under 10MB');
      return;
    }

    setUploadingKnowledge(true);

    try {
      const token = await getToken();
      if (!token) {
        toast.error('Authentication required. Please sign in again.');
        return;
      }

      // Step 1: Get upload URL from backend
      const uploadRes = await uploadKnowledge(id, { filename: file.name, fileType: ext }, token);
      
      if (!uploadRes.success || !uploadRes.data?.upload) {
        throw new Error('Failed to get upload URL');
      }
      
      const { upload } = uploadRes.data;

      // Step 2: Upload to Cloudinary (unsigned upload with preset)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('public_id', upload.publicId);
      formData.append('upload_preset', upload.uploadPreset);

      let cloudinaryRes: Response;
      let cloudinaryData: { secure_url?: string; public_id?: string; error?: { message?: string } };
      
      try {
        cloudinaryRes = await fetch(upload.uploadUrl, {
          method: 'POST',
          body: formData,
        });
        cloudinaryData = await cloudinaryRes.json();
      } catch (networkError) {
        console.error('Cloudinary network error:', networkError);
        throw new Error('Network error during upload. Please check your connection.');
      }

      if (!cloudinaryRes.ok || !cloudinaryData.secure_url) {
        console.error('Cloudinary upload error:', cloudinaryData);
        throw new Error(cloudinaryData?.error?.message || 'Upload to storage failed');
      }

      // Step 3: Confirm upload with the actual public_id from Cloudinary response
      const confirmRes = await confirmKnowledgeUpload(
        uploadRes.data.file.id,
        {
          cloudinaryUrl: cloudinaryData.secure_url,
          cloudinaryPublicId: cloudinaryData.public_id || upload.publicId,
        },
        token
      );

      if (!confirmRes.success) {
        throw new Error('Failed to confirm upload');
      }

      toast.success('Document uploaded and processing');
      fetchTemplate();
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    } finally {
      setUploadingKnowledge(false);
      // Reset the input
      e.target.value = '';
    }
  };

  const handleDeleteKnowledge = async (fileId: string) => {
    try {
      const token = await getToken();
      if (!token) return;

      await deleteKnowledgeFile(fileId, token);
      toast.success('Document deleted');
      fetchTemplate();
    } catch (error) {
      toast.error('Failed to delete document');
    }
  };

  // Settings save handler (mode + voice)
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const token = await getToken();
      if (!token) return;

      await updateTemplate(
        id,
        {
          // Mode settings
          mode: templateMode,
          inquiryWelcome: inquiryWelcome || undefined,
          inquiryGoal: inquiryGoal || undefined,
          // Voice settings
          enableVoiceOutput,
          voiceId: selectedVoice,
          voiceIntroMessage: voiceIntroMessage || undefined,
        },
        token
      );
      toast.success('Settings saved');
      fetchTemplate();
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const previewVoice = async (voiceId: OpenAIVoice) => {
    // Stop any existing playback
    stopVoicePreview();
    setPreviewingVoice(voiceId);

    const elevenLabsKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;
    const voiceOption = VOICE_OPTIONS.find(v => v.id === voiceId);
    
    if (!voiceOption) {
      setPreviewingVoice(null);
      return;
    }

    try {
      if (elevenLabsKey) {
        // Use ElevenLabs API for high-quality preview
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceOption.elevenLabsName}/stream`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': elevenLabsKey,
              'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({
              text: 'Hello! I will be guiding you through your application today. How are you?',
              model_id: 'eleven_flash_v2_5',
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.8,
              },
            }),
          }
        );

        if (!response.ok) {
          throw new Error('ElevenLabs API error');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        setAudioElement(audio);
        
        audio.onended = () => {
          setPreviewingVoice(null);
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          setPreviewingVoice(null);
          URL.revokeObjectURL(url);
        };
        
        await audio.play();
      } else {
        // Fallback to browser's speech synthesis
        const utterance = new SpeechSynthesisUtterance(
          'Hello! I will be guiding you through your application today.'
        );
        
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          const voiceIndex = VOICE_OPTIONS.findIndex(v => v.id === voiceId);
          utterance.voice = voices[Math.min(voiceIndex, voices.length - 1)];
        }
        
        utterance.onend = () => setPreviewingVoice(null);
        utterance.onerror = () => setPreviewingVoice(null);
        
        window.speechSynthesis.speak(utterance);
      }
    } catch (error) {
      console.error('Voice preview failed:', error);
      toast.error('Voice preview failed. Please try again.');
      setPreviewingVoice(null);
    }
  };

  const stopVoicePreview = () => {
    window.speechSynthesis.cancel();
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
      setAudioElement(null);
    }
    setPreviewingVoice(null);
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

  if (!template) {
    return (
      <div className="p-8">
        <p className="text-text-secondary">Template not found</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Back link */}
      <Link
        href="/dashboard/templates"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Interviews
      </Link>

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">{template.name}</h1>
        <p className="text-text-secondary mt-1">{template.personaPrompt}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-border-light rounded-lg w-fit">
        {(['questions', 'links', 'knowledge', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-md transition-all duration-200',
              activeTab === tab
                ? 'bg-white text-text-primary shadow-soft-sm'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Questions Tab */}
      {activeTab === 'questions' && (
        <div className="space-y-4">
          {/* Existing Questions with Drag and Drop */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={template.questions?.map((q) => q.id) || []}
              strategy={verticalListSortingStrategy}
            >
              {template.questions?.map((question: Question, index: number) => (
                <SortableQuestionItem
                  key={question.id}
                  question={question}
                  index={index}
                  onDelete={handleDeleteQuestion}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add Question Form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add Question
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Question Text</Label>
                  <AIGenerateButton
                    fieldType="question"
                    currentValue={newQuestion}
                    onGenerate={setNewQuestion}
                    context={template?.name ? `Interview: ${template.name}` : undefined}
                  />
                </div>
                <Textarea
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="Enter your question..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Rubric (Optional)</Label>
                  <AIGenerateButton
                    fieldType="rubric"
                    currentValue={newRubric}
                    onGenerate={setNewRubric}
                    context={newQuestion ? `Question: ${newQuestion}` : undefined}
                  />
                </div>
                <Textarea
                  value={newRubric}
                  onChange={(e) => setNewRubric(e.target.value)}
                  placeholder="What makes a good answer? What points should be covered?"
                  rows={2}
                />
              </div>
              <Button
                onClick={handleAddQuestion}
                disabled={addingQuestion || !newQuestion.trim()}
              >
                {addingQuestion ? 'Adding...' : 'Add Question'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Links Tab */}
      {activeTab === 'links' && (
        <div className="space-y-6">
          {/* Create Link Form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                Generate Application Link
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Link Settings Grid */}
              <div className="grid grid-cols-3 gap-6">
                {/* Link Type */}
                <div>
                  <p className="text-sm text-text-secondary mb-2">Type</p>
                  <div className="flex gap-2">
                    <ToggleBtn selected={linkType === 'permanent'} onClick={() => setLinkType('permanent')}>Permanent</ToggleBtn>
                    <ToggleBtn selected={linkType === 'one_time'} onClick={() => setLinkType('one_time')}>One-Time</ToggleBtn>
                  </div>
                </div>

                {/* Voice Mode */}
                <div>
                  <p className="text-sm text-text-secondary mb-2">Voice</p>
                  <div className="flex gap-2">
                    <ToggleBtn selected={linkEnableVoice === null} onClick={() => setLinkEnableVoice(null)}>Inherit</ToggleBtn>
                    <ToggleBtn selected={linkEnableVoice === false} onClick={() => setLinkEnableVoice(false)}>Text</ToggleBtn>
                    <ToggleBtn selected={linkEnableVoice === true} onClick={() => setLinkEnableVoice(true)}>Voice</ToggleBtn>
                  </div>
                </div>

                {/* File Upload */}
                <div>
                  <p className="text-sm text-text-secondary mb-2">Files</p>
                  <div className="flex gap-2">
                    <ToggleBtn selected={!allowFileUpload} onClick={() => setAllowFileUpload(false)}>Off</ToggleBtn>
                    <ToggleBtn selected={allowFileUpload} onClick={() => setAllowFileUpload(true)}>On</ToggleBtn>
                  </div>
                </div>
              </div>

              {/* File Upload Details (if enabled) */}
              {allowFileUpload && (
                <div className="flex items-center gap-4 text-sm text-text-muted">
                  <span>Max:</span>
                  <Input type="number" min={1} max={5} value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value))} className="w-14 h-7" />
                  <span>files,</span>
                  <Input type="number" min={1} max={25} value={maxFileSizeMb} onChange={(e) => setMaxFileSizeMb(Number(e.target.value))} className="w-14 h-7" />
                  <span>MB each</span>
                </div>
              )}

              <Button onClick={handleCreateLink} disabled={creatingLink}>
                {creatingLink ? 'Creating...' : 'Generate Link'}
              </Button>
            </CardContent>
          </Card>

          {/* Existing Links */}
          {template.links && template.links.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active Links</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {template.links
                    .filter((link: InterviewLink) => link.isActive)
                    .map((link: InterviewLink) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between p-3 bg-background-secondary rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-xs text-text-secondary">
                              {link.linkType === 'permanent' ? 'Permanent' : 'One-time'}
                            </span>
                            <span className="text-xs text-text-muted">·</span>
                            <span className="text-xs text-text-secondary">
                              {link.enableVoiceOutput === true ? 'Voice' : link.enableVoiceOutput === false ? 'Text' : 'Inherit'}
                            </span>
                            {link.allowFileUpload && (
                              <>
                                <span className="text-xs text-text-muted">·</span>
                                <span className="text-xs text-text-secondary">Files</span>
                              </>
                            )}
                            <span className="text-xs text-text-muted">·</span>
                            <span className="text-xs text-text-secondary">
                              {link.useCount} used
                            </span>
                          </div>
                          <code className="text-xs text-text-muted truncate block">
                            {link.fullUrl}
                          </code>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => link.fullUrl && copyLink(link.fullUrl)}
                            className="p-2 text-text-muted hover:text-text-primary"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <a
                            href={link.fullUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 text-text-muted hover:text-text-primary"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => handleRevokeLink(link.id)}
                            className="p-2 text-text-muted hover:text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Knowledge Tab */}
      {activeTab === 'knowledge' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Knowledge Base
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-text-secondary mb-4">
              Upload documents that the AI can use to answer candidate questions about the
              role, company, or process.
            </p>
            
            {/* Upload Zone */}
            <label
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all block',
                'hover:border-primary-light hover:bg-primary-light/5',
                uploadingKnowledge && 'pointer-events-none opacity-60'
              )}
            >
              <input
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md"
                onChange={handleKnowledgeUpload}
                disabled={uploadingKnowledge}
              />
              {uploadingKnowledge ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  <span className="text-text-secondary">Uploading...</span>
                </div>
              ) : (
                <>
                  <div
                    className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
                    style={{ background: 'var(--gradient-fig-subtle)' }}
                  >
                    <Upload className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-text-secondary mb-2">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-text-muted">PDF, DOCX, TXT, MD • Max 10MB</p>
                </>
              )}
            </label>

            {/* Uploaded Files */}
            {template.knowledgeFiles && template.knowledgeFiles.length > 0 && (
              <div className="mt-6 space-y-2">
                <p className="text-sm font-medium text-text-primary mb-3">
                  Uploaded Documents ({template.knowledgeFiles.length})
                </p>
                {template.knowledgeFiles.map((file: KnowledgeFile) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3 bg-background-secondary rounded-lg group"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-text-muted" />
                      <span className="text-sm text-text-primary">{file.filename}</span>
                      <span
                        className={cn(
                          'px-2 py-0.5 text-xs font-medium rounded-full',
                          file.status === 'ready'
                            ? 'bg-green-100 text-green-700'
                            : file.status === 'processing'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                        )}
                      >
                        {file.status}
                      </span>
                      {file.chunkCount && file.chunkCount > 0 && (
                        <span className="text-xs text-text-muted">
                          {file.chunkCount} chunks
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteKnowledge(file.id)}
                      className="p-2 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Mode Selector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Experience Mode
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="text-sm text-text-secondary mb-2">Mode</p>
                <div className="flex gap-2">
                  <ToggleBtn selected={templateMode === 'application'} onClick={() => setTemplateMode('application')}>Application</ToggleBtn>
                  <ToggleBtn selected={templateMode === 'inquiry'} onClick={() => setTemplateMode('inquiry')}>Inquiry</ToggleBtn>
                </div>
                <p className="text-xs text-text-muted mt-2">
                  {templateMode === 'application' ? 'Structured Q&A with follow-ups and evaluation' : 'Open conversation for general inquiries'}
                </p>
              </div>

              {/* Inquiry Mode Settings */}
              {templateMode === 'inquiry' && (
                <div className="border-t border-border-light pt-6 space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label htmlFor="inquiry-welcome" className="text-sm font-medium text-text-primary">
                        Welcome Message
                      </Label>
                      <AIGenerateButton
                        fieldType="inquiry_welcome"
                        currentValue={inquiryWelcome}
                        onGenerate={setInquiryWelcome}
                        context={template?.name ? `For: ${template.name}` : undefined}
                      />
                    </div>
                    <p className="text-xs text-text-muted mb-2">
                      The first message visitors will see when they start a conversation
                    </p>
                    <Textarea
                      id="inquiry-welcome"
                      value={inquiryWelcome}
                      onChange={(e) => setInquiryWelcome(e.target.value)}
                      placeholder="Hello! How can I help you today? Feel free to ask any questions about our company, roles, or anything else."
                      className="min-h-[80px]"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label htmlFor="inquiry-goal" className="text-sm font-medium text-text-primary">
                        Conversation Goal
                      </Label>
                      <AIGenerateButton
                        fieldType="inquiry_goal"
                        currentValue={inquiryGoal}
                        onGenerate={setInquiryGoal}
                      />
                    </div>
                    <p className="text-xs text-text-muted mb-2">
                      Instructions for the AI on what information to gather (optional)
                    </p>
                    <Textarea
                      id="inquiry-goal"
                      value={inquiryGoal}
                      onChange={(e) => setInquiryGoal(e.target.value)}
                      placeholder="Try to understand the visitor's needs. Ask for their name and email if they want to be contacted. Note any specific questions they have about job openings."
                      className="min-h-[80px]"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Voice Output Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                Voice Output
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="text-sm text-text-secondary mb-2">Voice Responses</p>
                <div className="flex gap-2">
                  <ToggleBtn selected={!enableVoiceOutput} onClick={() => setEnableVoiceOutput(false)}>Off</ToggleBtn>
                  <ToggleBtn selected={enableVoiceOutput} onClick={() => setEnableVoiceOutput(true)}>On</ToggleBtn>
                </div>
              </div>

              {enableVoiceOutput && (
                <div className="border-t border-border-light pt-6">
                  <p className="text-sm text-text-secondary mb-3">Voice</p>
                  <div className="flex flex-wrap gap-2">
                    {VOICE_OPTIONS.map((voice) => (
                      <div key={voice.id} className="flex items-center gap-1">
                        <ToggleBtn 
                          selected={selectedVoice === voice.id} 
                          onClick={() => setSelectedVoice(voice.id)}
                        >
                          {voice.name}
                        </ToggleBtn>
                        <button
                          onClick={() => previewingVoice === voice.id ? stopVoicePreview() : previewVoice(voice.id)}
                          className="p-1 text-text-muted hover:text-text-primary"
                        >
                          {previewingVoice === voice.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Voice Intro Message */}
                  <div className="mt-6 pt-6 border-t border-border-light">
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="voice-intro" className="text-sm font-medium text-text-primary">
                        Introduction Message
                      </Label>
                      <AIGenerateButton
                        fieldType="voice_intro"
                        currentValue={voiceIntroMessage}
                        onGenerate={setVoiceIntroMessage}
                        context={template?.name ? `Interview: ${template.name}` : undefined}
                      />
                    </div>
                    <p className="text-xs text-text-muted mb-3">
                      This message is spoken by the AI when the voice session starts, before transcription begins.
                    </p>
                    <Textarea
                      id="voice-intro"
                      value={voiceIntroMessage}
                      onChange={(e) => setVoiceIntroMessage(e.target.value)}
                      placeholder="Hello! Welcome to your application. I'm here to learn more about you. When you're ready, just start speaking and I'll listen."
                      className="resize-none"
                      rows={3}
                    />
                    <p className="text-xs text-text-muted mt-2">
                      Leave empty to use the default: "Hello! Welcome to your application. I'm here to learn more about you. When you're ready, just start speaking and I'll listen."
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t border-border-light">
                <Button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                >
                  {savingSettings ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save All Settings'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Additional Settings Info */}
          <Card>
            <CardContent className="py-6">
              <div className="flex items-start gap-4">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--gradient-fig-subtle)' }}
                >
                  <Settings className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-text-primary">Voice Mode Experience</p>
                  <p className="text-sm text-text-secondary mt-1">
                    When enabled, candidates will see a minimal voice interface during the
                    application. They can speak naturally and hear AI responses, creating a
                    more conversational experience. The AI will handle turn-taking automatically.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
