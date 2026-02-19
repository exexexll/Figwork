// API Response Types

// Voice options - mapped to ElevenLabs voices for high-quality TTS
export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

// ElevenLabs voice mappings (using their premium voice library)
// See: https://elevenlabs.io/app/voice-library
export const VOICE_OPTIONS: { id: OpenAIVoice; name: string; description: string; elevenLabsName: string }[] = [
  { id: 'alloy', name: 'Adam', description: 'Deep, authoritative American male', elevenLabsName: 'pNInz6obpgDQGcFmaJgB' },
  { id: 'echo', name: 'Bella', description: 'Soft, warm female voice', elevenLabsName: 'EXAVITQu4vr4xnSDxMaL' },
  { id: 'fable', name: 'Antoni', description: 'Expressive, well-rounded male', elevenLabsName: 'ErXwobaYiN019PkySvjV' },
  { id: 'onyx', name: 'Arnold', description: 'Crisp, American male', elevenLabsName: 'VR6AewLTigWG4xSOukaG' },
  { id: 'nova', name: 'Dorothy', description: 'Pleasant, British female', elevenLabsName: 'ThT5KcBeYPX3keUQqHPh' },
  { id: 'shimmer', name: 'Domi', description: 'Strong, assertive female', elevenLabsName: 'AZnzlk1XvdvUeBnXmlld' },
];

// Template modes
export type TemplateMode = 'application' | 'inquiry';

export interface Template {
  id: string;
  ownerId: string;
  name: string;
  mode: TemplateMode;
  personaPrompt: string;
  toneGuidance: string | null;
  // Inquiry mode settings
  inquiryWelcome: string | null;
  inquiryGoal: string | null;
  // Application mode settings
  globalFollowupLimit: number;
  timeLimitMinutes: number;
  // Voice settings
  enableVoiceOutput: boolean;
  voiceId: OpenAIVoice;
  voiceIntroMessage: string | null;
  createdAt: string;
  updatedAt: string;
  questions?: Question[];
  links?: InterviewLink[];
  knowledgeFiles?: KnowledgeFile[];
  _count?: {
    questions: number;
    links: number;
    sessions: number;
  };
}

export interface Question {
  id: string;
  templateId: string;
  questionText: string;
  rubric: string | null;
  maxFollowups: number;
  askVerbatim: boolean;
  orderIndex: number;
  createdAt: string;
}

export interface InterviewLink {
  id: string;
  templateId: string;
  token: string;
  linkType: 'one_time' | 'permanent';
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  isActive: boolean;
  // File upload settings
  allowFileUpload: boolean;
  maxFiles: number;
  maxFileSizeMb: number;
  allowedFileTypes: string[];
  // Voice settings
  enableVoiceOutput: boolean | null;
  voiceId: OpenAIVoice | null;
  // Mode override
  mode: TemplateMode | null;
  createdAt: string;
  fullUrl?: string;
  sessionCount?: number;
}

export interface Session {
  id: string;
  linkId: string;
  templateId: string;
  sessionToken: string;
  status: 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'error';
  currentQuestionIndex: number;
  followupsUsedCurrent: number;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  audioPublicId: string | null;
  audioUrl: string | null;
  createdAt: string;
  template?: Template;
  link?: InterviewLink;
  summary?: InterviewSummary | null;
  candidateFiles?: CandidateFile[];
  templateName?: string;
  // Mode: application or inquiry
  mode?: TemplateMode;
  messageCount?: number;
  hasSummary?: boolean;
}

export interface TranscriptMessage {
  id: string;
  sessionId: string;
  questionId: string | null;
  role: 'ai' | 'candidate';
  content: string;
  messageType: string;
  timestampMs: string;
  createdAt: string;
  question?: {
    id: string;
    questionText: string;
    orderIndex: number;
  } | null;
}

export interface InterviewSummary {
  id: string;
  sessionId: string;
  strengths: string[] | null;
  gaps: string[] | null;
  rubricCoverage: Record<string, unknown> | null;
  supportingQuotes: string[] | null;
  rawSummary: string | null;
  createdAt: string;
}

export interface KnowledgeFile {
  id: string;
  ownerId: string;
  templateId: string;
  filename: string;
  fileType: string;
  cloudinaryPublicId: string | null;
  cloudinaryUrl: string | null;
  status: 'pending' | 'processing' | 'ready' | 'error';
  createdAt: string;
  chunkCount?: number;
}

export interface CandidateFile {
  id: string;
  sessionId: string;
  filename: string;
  fileType: string;
  fileSizeBytes: number;
  cloudinaryPublicId: string;
  cloudinaryUrl: string;
  extractedText: string | null;
  status: 'pending' | 'processing' | 'ready' | 'error';
  uploadedAt: string;
}

// Input types for API calls
export interface CreateTemplateInput {
  name: string;
  mode?: TemplateMode;
  personaPrompt: string;
  toneGuidance?: string;
  // Inquiry mode settings
  inquiryWelcome?: string;
  inquiryGoal?: string;
  // Application mode settings
  globalFollowupLimit?: number;
  timeLimitMinutes?: number;
  // Voice settings
  enableVoiceOutput?: boolean;
  voiceId?: OpenAIVoice;
  voiceIntroMessage?: string;
}

export interface UpdateTemplateInput {
  name?: string;
  mode?: TemplateMode;
  personaPrompt?: string;
  toneGuidance?: string;
  // Inquiry mode settings
  inquiryWelcome?: string;
  inquiryGoal?: string;
  // Application mode settings
  globalFollowupLimit?: number;
  timeLimitMinutes?: number;
  // Voice settings
  enableVoiceOutput?: boolean;
  voiceId?: OpenAIVoice;
  voiceIntroMessage?: string;
}

export interface CreateQuestionInput {
  questionText: string;
  rubric?: string;
  maxFollowups?: number;
  askVerbatim?: boolean;
}

export interface UpdateQuestionInput {
  questionText?: string;
  rubric?: string;
  maxFollowups?: number;
  askVerbatim?: boolean;
}

export interface CreateLinkInput {
  linkType: 'one_time' | 'permanent';
  expiresAt?: string;
  maxUses?: number;
  // Mode override (optional - inherits from template if not set)
  mode?: TemplateMode;
  allowFileUpload?: boolean;
  maxFiles?: number;
  maxFileSizeMb?: number;
  allowedFileTypes?: string[];
  enableVoiceOutput?: boolean;
  voiceId?: OpenAIVoice;
}

export interface RegisterCandidateFileInput {
  filename: string;
  fileType: string;
  fileSizeBytes: number;
  cloudinaryPublicId: string;
  cloudinaryUrl: string;
}

// Interview page types
export interface InterviewInfo {
  valid: boolean;
  templateName?: string;
  // Mode determines application vs inquiry experience
  mode?: TemplateMode;
  questionCount?: number;
  // Inquiry mode settings
  inquiryWelcome?: string;
  inquiryGoal?: string;
  timeLimitMinutes?: number;
  // File upload settings
  allowFileUpload?: boolean;
  maxFiles?: number;
  maxFileSizeMb?: number;
  allowedFileTypes?: string[];
  // Voice settings
  enableVoiceOutput?: boolean;
  voiceId?: OpenAIVoice;
}

export interface FileUploadConfig {
  allowFileUpload: boolean;
  maxFiles: number;
  maxFileSizeMb: number;
  allowedFileTypes: string[];
}
