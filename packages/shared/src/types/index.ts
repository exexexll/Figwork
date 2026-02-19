// User types
export interface User {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Interview Template types
export interface InterviewTemplate {
  id: string;
  ownerId: string;
  name: string;
  personaPrompt: string;
  toneGuidance: string | null;
  globalFollowupLimit: number;
  timeLimitMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

// Question types
export interface Question {
  id: string;
  templateId: string;
  questionText: string;
  rubric: string | null;
  maxFollowups: number;
  askVerbatim: boolean;
  orderIndex: number;
  createdAt: Date;
}

// Interview Link types
export type LinkType = 'one_time' | 'permanent';

export interface InterviewLink {
  id: string;
  templateId: string;
  token: string;
  linkType: LinkType;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  isActive: boolean;
  allowFileUpload: boolean;
  maxFiles: number;
  maxFileSizeMb: number;
  allowedFileTypes: string[];
  createdAt: Date;
}

// Interview Session types
export type SessionStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'error';

export interface InterviewSession {
  id: string;
  linkId: string;
  templateId: string;
  sessionToken: string;
  status: SessionStatus;
  currentQuestionIndex: number;
  followupsUsedCurrent: number;
  startedAt: Date | null;
  completedAt: Date | null;
  lastActivityAt: Date | null;
  audioUrl: string | null;
  audioPublicId: string | null;
  createdAt: Date;
}

// Transcript Message types
export type MessageRole = 'ai' | 'candidate';
export type MessageType = 'fixed_question' | 'followup' | 'answer' | 'candidate_question' | 'kb_answer' | 'meta';

export interface TranscriptMessage {
  id: string;
  sessionId: string;
  questionId: string | null;
  role: MessageRole;
  content: string;
  messageType: MessageType;
  timestampMs: number;
  createdAt: Date;
}

// Controller Output types
export type TurnType = 'ANSWER' | 'CANDIDATE_QUESTION' | 'META';
export type NextAction = 'ASK_FOLLOWUP' | 'ADVANCE_QUESTION' | 'ANSWER_CANDIDATE_QUESTION' | 'HANDLE_META' | 'END_INTERVIEW';

export interface ControllerOutput {
  turn_type: TurnType;
  is_sufficient: boolean;
  missing_points: string[];
  next_action: NextAction;
  followup_question: string | null;
  candidate_answer_summary: string | null;
  detected_candidate_question: string | null;
  kb_answer: string | null;
  kb_citations: string[];
  file_reference: string | null; // Reference to specific item from candidate's uploaded documents
}

// Evaluation Decision types
export interface EvaluationDecision {
  id: string;
  sessionId: string;
  questionId: string | null;
  turnType: string;
  isSufficient: boolean | null;
  missingPoints: string[] | null;
  nextAction: string;
  followupQuestion: string | null;
  rawControllerOutput: ControllerOutput | null;
  createdAt: Date;
}

// Interview Summary types
export interface InterviewSummary {
  id: string;
  sessionId: string;
  strengths: string[] | null;
  gaps: string[] | null;
  rubricCoverage: Record<string, unknown> | null;
  supportingQuotes: string[] | null;
  rawSummary: string | null;
  createdAt: Date;
}

// Knowledge File types
export type FileStatus = 'pending' | 'processing' | 'ready' | 'error';

export interface KnowledgeFile {
  id: string;
  ownerId: string;
  templateId: string;
  filename: string;
  fileType: string;
  cloudinaryPublicId: string | null;
  cloudinaryUrl: string | null;
  status: FileStatus;
  createdAt: Date;
}

// Knowledge Chunk types
export interface KnowledgeChunk {
  id: string;
  fileId: string;
  ownerId: string;
  templateId: string;
  content: string;
  pageNumber: number | null;
  section: string | null;
  tokenCount: number | null;
  similarity?: number;
  createdAt: Date;
}

// Candidate File types
export interface CandidateFile {
  id: string;
  sessionId: string;
  filename: string;
  fileType: string;
  fileSizeBytes: number;
  cloudinaryPublicId: string;
  cloudinaryUrl: string;
  extractedText: string | null;
  status: FileStatus;
  uploadedAt: Date;
}

// WebSocket Event types
export interface WSEventCandidateTranscript {
  transcript: string;
  timestamp: number;
}

export interface WSEventCandidateInterrupt {
  transcript: string;
  timestamp: number;
  wasInterrupted: boolean;
}

export interface WSEventAIMessageToken {
  token: string;
}

export interface WSEventAIMessageEnd {
  message: string;
}

export interface WSEventQuestionAdvanced {
  index: number;
  total: number;
}

export interface WSEventError {
  message: string;
}

// Cached Session State for Redis
export interface CachedSessionState {
  sessionId: string;
  templateId: string;
  currentQuestionIndex: number;
  followupsUsedCurrent: number;
  status: SessionStatus;
  questions: Array<{
    id: string;
    text: string;
    rubric: string | null;
    maxFollowups: number;
  }>;
  recentTranscript: Array<{
    role: MessageRole;
    content: string;
    timestamp: number;
  }>;
  candidateFilesSummary: string | null;
  pendingPartial?: string;
  awaitingIntroResponse?: boolean; // True while waiting for user to respond to voice intro
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Link Resolution Response
export interface LinkResolutionResponse {
  valid: boolean;
  templateName?: string;
  personaName?: string;
  allowFileUpload?: boolean;
  maxFiles?: number;
  maxFileSizeMb?: number;
  allowedFileTypes?: string[];
  expired?: boolean;
  used?: boolean;
}

// Session Start Response
export interface SessionStartResponse {
  sessionToken: string;
  ephemeralToken: string;
  questions: Array<{
    id: string;
    text: string;
    orderIndex: number;
  }>;
  firstQuestion: string;
}

// Upload URL Response
export interface UploadUrlResponse {
  uploadUrl: string;
  publicId: string;
  timestamp: number;
  signature: string;
  apiKey: string;
}
