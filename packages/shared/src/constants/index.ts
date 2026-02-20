// Session status constants
export const SESSION_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
  ERROR: 'error',
} as const;

// Link type constants
export const LINK_TYPE = {
  ONE_TIME: 'one_time',
  PERMANENT: 'permanent',
} as const;

// Template mode constants
export const TEMPLATE_MODE = {
  APPLICATION: 'application', // Structured Q&A with evaluation
  INQUIRY: 'inquiry',         // Open conversation, gather info
} as const;

// File status constants
export const FILE_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  READY: 'ready',
  ERROR: 'error',
} as const;

// Message role constants
export const MESSAGE_ROLE = {
  AI: 'ai',
  CANDIDATE: 'candidate',
} as const;

// Message type constants
export const MESSAGE_TYPE = {
  FIXED_QUESTION: 'fixed_question',
  FOLLOWUP: 'followup',
  ANSWER: 'answer',
  CANDIDATE_QUESTION: 'candidate_question',
  KB_ANSWER: 'kb_answer',
  META: 'meta',
} as const;

// Controller next action constants
export const NEXT_ACTION = {
  ASK_FOLLOWUP: 'ASK_FOLLOWUP',
  ADVANCE_QUESTION: 'ADVANCE_QUESTION',
  ANSWER_CANDIDATE_QUESTION: 'ANSWER_CANDIDATE_QUESTION',
  HANDLE_META: 'HANDLE_META',
  END_INTERVIEW: 'END_INTERVIEW',
} as const;

// Turn type constants
export const TURN_TYPE = {
  ANSWER: 'ANSWER',
  CANDIDATE_QUESTION: 'CANDIDATE_QUESTION',
  META: 'META',
} as const;

// WebSocket events - Client to Server
export const WS_CLIENT_EVENTS = {
  CANDIDATE_TRANSCRIPT_FINAL: 'candidate_transcript_final',
  CANDIDATE_TRANSCRIPT_PARTIAL: 'candidate_transcript_partial',
  CANDIDATE_INTERRUPT: 'candidate_interrupt',
  END_INTERVIEW: 'end_interview',
  MIC_MUTED: 'mic_muted',
} as const;

// WebSocket events - Server to Client
export const WS_SERVER_EVENTS = {
  SESSION_STARTED: 'session_started',
  AI_MESSAGE_START: 'ai_message_start',
  AI_MESSAGE_TOKEN: 'ai_message_token',
  AI_MESSAGE_END: 'ai_message_end',
  QUESTION_ADVANCED: 'question_advanced',
  INTERVIEW_ENDED: 'interview_ended',
  FILE_READY: 'file_ready',
  MESSAGE_RECEIVED: 'message_received',
  TIME_WARNING: 'time_warning',
  TIME_EXPIRED: 'time_expired',
  ERROR: 'error',
} as const;

// Default values
export const DEFAULTS = {
  GLOBAL_FOLLOWUP_LIMIT: 3,
  MAX_FOLLOWUPS_PER_QUESTION: 2,
  TIME_LIMIT_MINUTES: 30,
  MAX_FILES: 3,
  MAX_FILE_SIZE_MB: 10,
  ALLOWED_FILE_TYPES: ['pdf', 'docx', 'txt', 'md'],
  CHUNK_MIN_TOKENS: 300,
  CHUNK_MAX_TOKENS: 600,
  CHUNK_OVERLAP_TOKENS: 60,
  RAG_TOP_K: 5,
  SESSION_CACHE_TTL_SECONDS: 3600,
  TRANSCRIPT_CONTEXT_SIZE: 10,
  SESSION_TOKEN_TTL_HOURS: 24, // Session tokens expire after 24 hours
  CLEANUP_INTERVAL_HOURS: 1,   // Run cleanup every hour
} as const;

// Latency targets (in ms) - Optimized for sub-100ms feel
export const LATENCY_TARGETS = {
  STT_PARTIAL: 80,
  STT_FINAL: 200,
  WEBSOCKET_RTT: 30,
  CONTROLLER_LLM: 150,  // gpt-4o-mini target
  INTERVIEWER_LLM: 100, // gpt-4o-mini streaming target
  FIRST_TOKEN: 100,     // Time to first visible response
  TTS_FIRST_AUDIO: 80,  // ElevenLabs flash target
  UI_RENDER: 16,
  TOTAL_TURN: 500,      // Total time from user done speaking to AI starts
} as const;

// Latency alert thresholds (in ms)
export const LATENCY_ALERTS = {
  STT_PARTIAL: 150,
  STT_FINAL: 400,
  CONTROLLER_LLM: 400,
  FIRST_TOKEN: 200,
  TTS_FIRST_AUDIO: 200,
  TOTAL_TURN: 1000,
} as const;

// OpenAI configuration — GPT-5.2 across all agents
export const OPENAI_CONFIG = {
  MODEL_CONTROLLER: 'gpt-5.2',
  MODEL_INTERVIEWER: 'gpt-5.2',
  MODEL_FULL: 'gpt-5.2',
  REALTIME_MODEL: 'gpt-4o-realtime-preview-2024-12-17', // Realtime keeps existing model until 5.2 realtime is available
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: 1536,
  // Tokens - balance between speed and quality
  MAX_TOKENS_CONTROLLER: 300,
  MAX_TOKENS_INTERVIEWER: 150, // Slightly more for natural responses
  // Temperature - higher = more natural/varied
  TEMPERATURE_CONTROLLER: 0.3, // Slightly higher for less robotic decisions
  TEMPERATURE_INTERVIEWER: 0.75, // Higher for natural conversation
} as const;

// Cloudinary configuration
export const CLOUDINARY_CONFIG = {
  UPLOAD_PRESET: 'figwork_interviews',
  INTERVIEWS_FOLDER: 'figwork/interviews',
  KNOWLEDGE_FOLDER: 'figwork/knowledge',
  CANDIDATE_FILES_FOLDER: 'figwork/candidate_files',
} as const;

// VAD (Voice Activity Detection) configuration
// Optimized for <100ms latency feel
export const VAD_CONFIG = {
  THRESHOLD: 0.5,            // Slightly lower = more responsive (0.0-1.0)
  PREFIX_PADDING_MS: 200,    // Balance between cutoff prevention and latency
  SILENCE_DURATION_MS: 200,  // Ultra-fast end-of-speech detection
} as const;

// BullMQ Queue names
export const QUEUE_NAMES = {
  KNOWLEDGE_PROCESSING: 'knowledge-processing',
  CANDIDATE_FILE_PROCESSING: 'candidate-file-processing',
  POST_PROCESSING: 'post-processing',
  PDF_GENERATION: 'pdf-generation',
  // Marketplace queues
  POW_ANALYSIS: 'pow-analysis',
  QA_CHECK: 'qa-check',
  PAYOUT_PROCESS: 'payout-process',
  NOTIFICATION: 'notification',
  INVOICE_GENERATION: 'invoice-generation',
  DEFECT_ANALYSIS: 'defect-analysis',
} as const;

// Re-export tier and pricing constants
export * from './tiers';
export * from './pricing';
