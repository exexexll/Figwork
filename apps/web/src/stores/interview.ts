import { create } from 'zustand';

interface InterviewState {
  // Session info
  sessionToken: string | null;
  templateName: string | null;
  
  // Current state
  isActive: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  isAiStreaming: boolean;
  
  // Progress
  currentQuestionIndex: number;
  totalQuestions: number;
  
  // Content
  aiMessage: string;
  transcript: string;
  partialTranscript: string;
  
  // Files
  uploadedFiles: Array<{
    id: string;
    filename: string;
    fileType: string;
    status: string;
  }>;
  
  // Actions
  setSessionToken: (token: string) => void;
  setTemplateName: (name: string) => void;
  setIsActive: (active: boolean) => void;
  setIsRecording: (recording: boolean) => void;
  setIsSpeaking: (speaking: boolean) => void;
  setIsAiStreaming: (streaming: boolean) => void;
  setProgress: (index: number, total: number) => void;
  setAiMessage: (message: string) => void;
  appendAiMessage: (token: string) => void;
  setTranscript: (transcript: string) => void;
  setPartialTranscript: (partial: string) => void;
  addUploadedFile: (file: { id: string; filename: string; fileType: string; status: string }) => void;
  reset: () => void;
}

const initialState = {
  sessionToken: null,
  templateName: null,
  isActive: false,
  isRecording: false,
  isSpeaking: false,
  isAiStreaming: false,
  currentQuestionIndex: 0,
  totalQuestions: 0,
  aiMessage: '',
  transcript: '',
  partialTranscript: '',
  uploadedFiles: [],
};

export const useInterviewStore = create<InterviewState>((set) => ({
  ...initialState,
  
  setSessionToken: (token) => set({ sessionToken: token }),
  setTemplateName: (name) => set({ templateName: name }),
  setIsActive: (active) => set({ isActive: active }),
  setIsRecording: (recording) => set({ isRecording: recording }),
  setIsSpeaking: (speaking) => set({ isSpeaking: speaking }),
  setIsAiStreaming: (streaming) => set({ isAiStreaming: streaming }),
  setProgress: (index, total) => set({ currentQuestionIndex: index, totalQuestions: total }),
  setAiMessage: (message) => set({ aiMessage: message }),
  appendAiMessage: (token) => set((state) => ({ aiMessage: state.aiMessage + token })),
  setTranscript: (transcript) => set({ transcript, partialTranscript: '' }),
  setPartialTranscript: (partial) => set({ partialTranscript: partial }),
  addUploadedFile: (file) => set((state) => ({ 
    uploadedFiles: [...state.uploadedFiles, file] 
  })),
  reset: () => set(initialState),
}));
