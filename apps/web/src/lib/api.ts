import type {
  Template,
  Question,
  InterviewLink,
  Session,
  TranscriptMessage,
  KnowledgeFile,
  CandidateFile,
  CreateTemplateInput,
  UpdateTemplateInput,
  CreateQuestionInput,
  UpdateQuestionInput,
  CreateLinkInput,
  RegisterCandidateFileInput,
  OpenAIVoice,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  token?: string;
}

async function apiFetch<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  const headers: HeadersInit = {};

  // Only set Content-Type if we have a body
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'API request failed');
  }

  return data;
}

// Templates
export async function getTemplates(token: string) {
  return apiFetch<{ success: boolean; data: Template[] }>('/api/templates', { token });
}

export async function getTemplate(id: string, token: string) {
  return apiFetch<{ success: boolean; data: Template }>(`/api/templates/${id}`, { token });
}

export async function createTemplate(data: CreateTemplateInput, token: string) {
  return apiFetch<{ success: boolean; data: Template }>('/api/templates', {
    method: 'POST',
    body: data,
    token,
  });
}

export async function updateTemplate(id: string, data: UpdateTemplateInput, token: string) {
  return apiFetch<{ success: boolean; data: Template }>(`/api/templates/${id}`, {
    method: 'PUT',
    body: data,
    token,
  });
}

export async function deleteTemplate(id: string, token: string) {
  return apiFetch<{ success: boolean }>(`/api/templates/${id}`, {
    method: 'DELETE',
    token,
  });
}

// Questions
export async function addQuestion(templateId: string, data: CreateQuestionInput, token: string) {
  return apiFetch<{ success: boolean; data: Question }>(`/api/templates/${templateId}/questions`, {
    method: 'POST',
    body: data,
    token,
  });
}

export async function updateQuestion(id: string, data: UpdateQuestionInput, token: string) {
  return apiFetch<{ success: boolean; data: Question }>(`/api/questions/${id}`, {
    method: 'PUT',
    body: data,
    token,
  });
}

export async function deleteQuestion(id: string, token: string) {
  return apiFetch<{ success: boolean }>(`/api/questions/${id}`, {
    method: 'DELETE',
    token,
  });
}

export async function reorderQuestions(templateId: string, questionIds: string[], token: string) {
  return apiFetch<{ success: boolean; data: Question[] }>(`/api/templates/${templateId}/questions/reorder`, {
    method: 'POST',
    body: { questionIds },
    token,
  });
}

// Links
export async function createLink(templateId: string, data: CreateLinkInput, token: string) {
  return apiFetch<{ success: boolean; data: InterviewLink }>(`/api/templates/${templateId}/links`, {
    method: 'POST',
    body: data,
    token,
  });
}

export async function getLinks(templateId: string, token: string) {
  return apiFetch<{ success: boolean; data: InterviewLink[] }>(`/api/templates/${templateId}/links`, { token });
}

export async function revokeLink(id: string, token: string) {
  return apiFetch<{ success: boolean }>(`/api/links/${id}`, {
    method: 'DELETE',
    token,
  });
}

// Sessions
export async function getSessions(token: string, templateId?: string) {
  const params = templateId ? `?templateId=${templateId}` : '';
  return apiFetch<{ success: boolean; data: Session[] }>(`/api/sessions${params}`, { token });
}

export async function getSession(id: string, token: string) {
  return apiFetch<{ success: boolean; data: Session }>(`/api/sessions/${id}`, { token });
}

export async function getSessionTranscript(id: string, token: string) {
  return apiFetch<{ success: boolean; data: TranscriptMessage[] }>(`/api/sessions/${id}/transcript`, { token });
}

export async function getSessionAudio(id: string, token: string) {
  return apiFetch<{ success: boolean; data: { url: string } }>(`/api/sessions/${id}/audio`, { token });
}

// Knowledge
export async function uploadKnowledge(templateId: string, data: { filename: string; fileType: string }, token: string) {
  return apiFetch<{
    success: boolean;
    data: {
      file: KnowledgeFile;
      upload: {
        uploadUrl: string;
        publicId: string;
        uploadPreset: string;
        cloudName: string;
        folder: string;
        resourceType: string;
      };
    };
  }>(`/api/templates/${templateId}/knowledge`, {
    method: 'POST',
    body: data,
    token,
  });
}

export async function confirmKnowledgeUpload(fileId: string, data: { cloudinaryUrl: string; cloudinaryPublicId: string }, token: string) {
  return apiFetch<{ success: boolean; data: { fileId: string; status: string } }>(`/api/knowledge/${fileId}/confirm`, {
    method: 'POST',
    body: data,
    token,
  });
}

export async function getKnowledgeFiles(templateId: string, token: string) {
  return apiFetch<{ success: boolean; data: KnowledgeFile[] }>(`/api/templates/${templateId}/knowledge`, { token });
}

export async function deleteKnowledgeFile(id: string, token: string) {
  return apiFetch<{ success: boolean }>(`/api/knowledge/${id}`, {
    method: 'DELETE',
    token,
  });
}

// Public interview endpoints (no auth required)
export async function resolveInterview(token: string) {
  return apiFetch<{
    success: boolean;
    valid: boolean;
    expired?: boolean;
    used?: boolean;
    templateName?: string;
    // Mode determines application vs inquiry experience
    mode?: 'application' | 'inquiry';
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
    voiceIntroMessage?: string;
  }>(`/api/interview/resolve/${token}`);
}

export async function startInterview(linkToken: string) {
  return apiFetch<{
    success: boolean;
    data: {
      sessionToken: string;
      ephemeralToken: string;
      // Mode determines application vs inquiry experience
      mode?: 'application' | 'inquiry';
      questions: Array<{ id: string; text: string; orderIndex: number }>;
      firstQuestion: string;
      // Inquiry mode settings
      inquiryWelcome?: string;
      inquiryGoal?: string;
      // Timer settings
      timeLimitMinutes: number;
      // File upload settings
      allowFileUpload: boolean;
      maxFiles: number;
      maxFileSizeMb: number;
      allowedFileTypes: string[];
      // Voice settings
      enableVoiceOutput?: boolean;
      voiceId?: OpenAIVoice;
      voiceIntroMessage?: string;
    };
  }>(`/api/interview/start/${linkToken}`, { method: 'POST' });
}

export async function getUploadUrl(sessionToken: string) {
  return apiFetch<{
    success: boolean;
    data: {
      uploadUrl: string;
      publicId: string;
      uploadPreset: string;
      cloudName: string;
      folder: string;
      resourceType: string;
    };
  }>(`/api/interview/${sessionToken}/upload-url`, { method: 'POST' });
}

export async function registerCandidateFile(sessionToken: string, data: RegisterCandidateFileInput) {
  return apiFetch<{ success: boolean; data: CandidateFile }>(`/api/interview/${sessionToken}/files`, {
    method: 'POST',
    body: data,
  });
}

export async function saveInterviewAudio(sessionToken: string, audioUrl: string, audioPublicId: string) {
  return apiFetch<{ success: boolean }>(`/api/interview/${sessionToken}/audio`, {
    method: 'POST',
    body: { audioUrl, audioPublicId },
  });
}

// Export session as different formats
export async function exportSession(sessionId: string, format: 'txt' | 'json' | 'pdf', token: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/export/${format}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Export failed');
  }

  // For JSON, return the data directly
  if (format === 'json') {
    return response.json();
  }

  // For TXT/PDF, return blob for download
  return response.blob();
}

export async function regenerateSummary(sessionId: string, token: string) {
  return apiFetch(`/api/sessions/${sessionId}/regenerate-summary`, {
    method: 'POST',
    token,
  });
}
