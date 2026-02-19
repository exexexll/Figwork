'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { resolveInterview, startInterview, getUploadUrl, registerCandidateFile, saveInterviewAudio } from '@/lib/api';
import { InterviewWebSocket } from '@/lib/websocket';
import { RealtimeSTTClient } from '@/lib/realtime-stt';
import { AudioRecorder } from '@/lib/audio-recorder';
import { FileUploadZone } from '@/components/interview/FileUploadZone';
import VoiceMode from '@/components/interview/VoiceMode';
import { X, Paperclip, Check, FileText, Upload, AlertCircle, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import type { InterviewInfo, FileUploadConfig, CandidateFile, OpenAIVoice } from '@/lib/types';

// States - 'upload' is for file upload step before the application begins
type ApplicationState = 'loading' | 'ready' | 'upload' | 'active' | 'ended' | 'error';

// Conversation history item
interface ConversationItem {
  id: string;
  role: 'ai' | 'candidate';
  content: string;
  questionIndex: number;
  timestamp: number;
  isAddition?: boolean; // If user added to a previous response
}

// LocalStorage key for saved candidate files
const SAVED_FILES_KEY = 'figwork_saved_files';

// Saved file structure for localStorage
interface SavedFile {
  name: string;
  type: string;
  sizeBytes: number;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  savedAt: number;
}

export default function ApplicationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  // State
  const [state, setState] = useState<ApplicationState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [applicationInfo, setApplicationInfo] = useState<InterviewInfo | null>(null);
  
  // Saved files from localStorage
  const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);
  const [selectedSavedFiles, setSelectedSavedFiles] = useState<Set<string>>(new Set());

  // Application state
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const [isWaitingForAi, setIsWaitingForAi] = useState(false); // Loading state after sending
  const [transcript, setTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  
  // Conversation history (conveyor belt)
  const [conversationHistory, setConversationHistory] = useState<ConversationItem[]>([]);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);
  const [isAddingToHistory, setIsAddingToHistory] = useState(false);
  const historyContainerRef = useRef<HTMLDivElement>(null);
  
  // Save current question's transcript when entering "add to history" mode
  const savedTranscriptRef = useRef<{
    transcript: string;
    partialTranscript: string;
    accumulatedTranscript: string;
  } | null>(null);
  
  // Track the full accumulated transcript for interrupt
  const accumulatedTranscriptRef = useRef('');
  
  // Track current utterance's partial transcript (resets on speech stop)
  const currentUtteranceRef = useRef('');
  
  // Track if first question was already received (to prevent duplicates)
  const firstQuestionReceivedRef = useRef(false);
  
  // Track if we're waiting for a new question after advance (prevents duplicate display)
  const awaitingNewQuestionRef = useRef(false);
  const lastQuestionTextRef = useRef('');
  
  // Ignore late transcripts after submitting (prevents leaking into next response)
  const ignoreTranscriptsRef = useRef(false);
  
  // Audio visualizer state
  const [audioLevels, setAudioLevels] = useState<number[]>([0, 0, 0, 0, 0]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Streaming text animation state
  const [displayedWords, setDisplayedWords] = useState<string[]>([]);
  const [isAnimatingText, setIsAnimatingText] = useState(false);
  const textAnimationRef = useRef<NodeJS.Timeout | null>(null);

  // File upload state
  const [uploadedFiles, setUploadedFiles] = useState<CandidateFile[]>([]);
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [ephemeralToken, setEphemeralToken] = useState<string | null>(null);
  const [fileUploadConfig, setFileUploadConfig] = useState<FileUploadConfig | null>(null);

  // Timer state
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Connection status
  const [wsConnected, setWsConnected] = useState(false);
  const [sttConnected, setSttConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Template mode state (application vs inquiry)
  const [templateMode, setTemplateMode] = useState<'application' | 'inquiry'>('application');
  const [inquiryWelcome, setInquiryWelcome] = useState<string | null>(null);

  // Voice mode state (voice-to-voice)
  const [enableVoiceOutput, setEnableVoiceOutput] = useState(false);
  const [voiceId, setVoiceId] = useState<OpenAIVoice>('nova');
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  // Refs
  const wsClient = useRef<InterviewWebSocket | null>(null);
  const sttClient = useRef<RealtimeSTTClient | null>(null);
  const audioRecorder = useRef<AudioRecorder | null>(null);
  const speechTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prewarmedStreamRef = useRef<MediaStream | null>(null);
  const [micPrewarmed, setMicPrewarmed] = useState(false);

  // Load saved files from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_FILES_KEY);
      if (saved) {
        const files = JSON.parse(saved) as SavedFile[];
        // Filter out files older than 30 days
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const validFiles = files.filter(f => f.savedAt > thirtyDaysAgo);
        setSavedFiles(validFiles);
        // Update localStorage with filtered files
        if (validFiles.length !== files.length) {
          localStorage.setItem(SAVED_FILES_KEY, JSON.stringify(validFiles));
        }
      }
    } catch (e) {
      console.warn('Failed to load saved files from localStorage:', e);
    }
  }, []);

  // Resolve link on mount
  useEffect(() => {
    async function init() {
      try {
        const result = await resolveInterview(token);

        if (!result.valid) {
          if (result.expired) {
            setError('This application link has expired.');
          } else if (result.used) {
            setError('This application link has already been used.');
          } else {
            setError('Invalid application link.');
          }
          setState('error');
          return;
        }

        setApplicationInfo(result);
        setState('ready');
        
        // Prewarm microphone while user is on ready screen
        try {
          sttClient.current = new RealtimeSTTClient();
          prewarmedStreamRef.current = await sttClient.current.prewarm();
          setMicPrewarmed(true);
          console.log('[Application] Microphone prewarmed');
        } catch (micErr) {
          console.warn('[Application] Mic prewarm failed (will retry on start):', micErr);
        }
      } catch (err) {
        setError('Failed to load application.');
        setState('error');
      }
    }

    init();
  }, [token]);

  // Proceed to upload step (when file upload is enabled)
  const handleProceedToUpload = async () => {
    try {
      setState('loading');

      // Start session to get config
      const result = await startInterview(token);
      const { 
        sessionToken: newSessionToken, 
        ephemeralToken: newEphemeralToken,
        timeLimitMinutes: timeLimit, 
        allowFileUpload, 
        maxFiles, 
        maxFileSizeMb, 
        allowedFileTypes, 
        questions,
        enableVoiceOutput: voiceEnabled,
        voiceId: voice,
        voiceIntroMessage: introMessage,
        mode,
        inquiryWelcome: welcome,
      } = result.data;

      setSessionToken(newSessionToken);
      setEphemeralToken(newEphemeralToken);
      setTotalQuestions(questions.length);
      
      // Store mode settings
      if (mode) {
        setTemplateMode(mode);
      }
      if (welcome) {
        setInquiryWelcome(welcome);
      }
      
      // Store file upload config
      setFileUploadConfig({
        allowFileUpload,
        maxFiles,
        maxFileSizeMb,
        allowedFileTypes,
      });

      // Store voice settings
      if (voiceEnabled !== undefined) {
        setEnableVoiceOutput(voiceEnabled);
      }
      if (voice) {
        setVoiceId(voice);
      }

      // Set up timer (only for application mode, optional for inquiry)
      if (timeLimit && mode !== 'inquiry') {
        setTimeLimitMinutes(timeLimit);
      }

      // If file upload is enabled, go to upload step
      if (allowFileUpload) {
        setState('upload');
      } else {
        // Otherwise start directly - pass ephemeral token directly since state update is async
        await startApplication(newSessionToken, timeLimit, newEphemeralToken);
      }
    } catch (err) {
      console.error('Failed to proceed:', err);
      setError('Failed to start. Please try again.');
      setState('error');
    }
  };

  // Start the actual application (after upload step or directly)
  const startApplication = async (currentSessionToken?: string, timeLimit?: number | null, currentEphemeralToken?: string) => {
    try {
      const tokenToUse = currentSessionToken || sessionToken;
      if (!tokenToUse) {
        setError('Session not found');
        setState('error');
        return;
      }
      
      // Use provided ephemeral token or fall back to state
      const ephemeralTokenToUse = currentEphemeralToken || ephemeralToken;

      setState('loading');
      setAiMessage('');
      
      // Use provided timeLimit or fall back to stored timeLimitMinutes state
      const effectiveTimeLimit = timeLimit ?? timeLimitMinutes;
      
      // Set up timer if we have a time limit
      if (effectiveTimeLimit) {
        setTimeLimitMinutes(effectiveTimeLimit);
        setStartTime(Date.now());
        setElapsedSeconds(0);
        
        // Clear any existing timer
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
        }
        
        timerIntervalRef.current = setInterval(() => {
          setElapsedSeconds((prev) => {
            const newElapsed = prev + 1;
            if (newElapsed >= effectiveTimeLimit * 60) {
              wsClient.current?.endInterview();
            }
            return newElapsed;
          });
        }, 1000);
      }

      // Initialize WebSocket
      wsClient.current = new InterviewWebSocket();

      wsClient.current.onSessionStarted = (data) => {
        setCurrentIndex(data.currentQuestionIndex);
        setTotalQuestions(data.totalQuestions);
      };

      // Track current streaming message for history
      let currentStreamingMessage = '';
      let currentQuestionIdx = 0;

      wsClient.current.onAiMessageStart = () => {
        if (textAnimationRef.current) {
          clearTimeout(textAnimationRef.current);
          textAnimationRef.current = null;
        }
        setIsAnimatingText(false);
        setDisplayedWords([]);
        setIsAiStreaming(true);
        setIsWaitingForAi(false);
        currentStreamingMessage = '';
        
        setCurrentIndex(idx => {
          currentQuestionIdx = idx;
          return idx;
        });
      };

      wsClient.current.onAiMessageToken = (messageToken) => {
        setIsWaitingForAi(false);
        currentStreamingMessage += messageToken;
        setAiMessage(currentStreamingMessage);
      };

      wsClient.current.onAiMessageEnd = (message) => {
        // Reset ignore flag - user can speak now
        ignoreTranscriptsRef.current = false;
        
        if (message === lastQuestionTextRef.current && !awaitingNewQuestionRef.current) {
          setIsAiStreaming(false);
          setIsWaitingForAi(false);
          return;
        }
        
        if (currentQuestionIdx === 0 && firstQuestionReceivedRef.current && !awaitingNewQuestionRef.current) {
          setIsAiStreaming(false);
          setIsWaitingForAi(false);
          return;
        }
        
        if (currentQuestionIdx === 0) {
          firstQuestionReceivedRef.current = true;
        }
        
        awaitingNewQuestionRef.current = false;
        lastQuestionTextRef.current = message;
        
        const historyItem: ConversationItem = {
          id: `ai-${Date.now()}`,
          role: 'ai',
          content: message,
          questionIndex: currentQuestionIdx,
          timestamp: Date.now(),
        };
        setConversationHistory(prev => [...prev, historyItem]);
        
        setIsAiStreaming(false);
        setIsWaitingForAi(false);
      };

      wsClient.current.onQuestionAdvanced = (index, total) => {
        awaitingNewQuestionRef.current = true;
        
        if (textAnimationRef.current) {
          clearTimeout(textAnimationRef.current);
          textAnimationRef.current = null;
        }
        setDisplayedWords([]);
        setIsAnimatingText(false);
        setAiMessage('');
        setCurrentIndex(index);
        setTotalQuestions(total);
        setTranscript('');
        setPartialTranscript('');
        setSelectedHistoryIndex(null);
        setIsAddingToHistory(false);
        
        accumulatedTranscriptRef.current = '';
        currentUtteranceRef.current = '';
      };

      wsClient.current.onInterviewEnded = async () => {
        setState('ended');
        
        try {
          if (audioRecorder.current && tokenToUse) {
            const blob = audioRecorder.current.stop();
            if (blob.size > 0) {
              const audioResult = await audioRecorder.current.uploadToCloudinary(blob, tokenToUse);
              await saveInterviewAudio(tokenToUse, audioResult.url, audioResult.publicId);
            }
          }
        } catch (err) {
          console.error('Failed to upload audio:', err);
        }
        
        cleanup();
      };

      wsClient.current.onError = (errorMsg) => {
        console.error('WebSocket error:', errorMsg);
        setConnectionError(errorMsg);
      };

      await wsClient.current.connect(tokenToUse);
      setWsConnected(true);

      // Initialize STT
      if (!sttClient.current) {
        sttClient.current = new RealtimeSTTClient();
      }
      
      try {
        // Use the ephemeral token from the initial startInterview call
        if (!ephemeralTokenToUse) {
          throw new Error('No ephemeral token available. Please refresh and try again.');
        }
        
        await sttClient.current.connect(ephemeralTokenToUse, {
          onTranscript: (text, isFinal) => {
            console.log('[STT] onTranscript:', { text: text.slice(0, 50), isFinal, ignoring: ignoreTranscriptsRef.current });
            // Ignore late transcripts after user submitted
            if (ignoreTranscriptsRef.current) {
              console.log('[STT] Ignoring late transcript:', text.slice(0, 30));
              return;
            }
            
            if (isFinal && text.trim()) {
              if (accumulatedTranscriptRef.current) {
                accumulatedTranscriptRef.current = accumulatedTranscriptRef.current.trim() + ' ' + text.trim();
              } else {
                accumulatedTranscriptRef.current = text.trim();
              }
              setTranscript(accumulatedTranscriptRef.current);
              setPartialTranscript('');
              console.log('[STT] Final transcript set:', accumulatedTranscriptRef.current.slice(0, 50));
            } else if (!isFinal) {
              setPartialTranscript(text);
            }
          },
          onSpeechStart: () => {
            console.log('[STT] Speech started, ignoring:', ignoreTranscriptsRef.current);
            // Don't show speech started if ignoring
            if (ignoreTranscriptsRef.current) return;
            
            setIsSpeaking(true);
            if (!accumulatedTranscriptRef.current) {
              setPartialTranscript('Listening...');
            } else {
              setPartialTranscript(accumulatedTranscriptRef.current + ' ...');
            }
            if (speechTimeoutRef.current) {
              clearTimeout(speechTimeoutRef.current);
            }
          },
          onSpeechStop: () => {
            if (ignoreTranscriptsRef.current) return;
            
            if (!accumulatedTranscriptRef.current) {
              setPartialTranscript('Processing...');
            }
            speechTimeoutRef.current = setTimeout(() => {
              setIsSpeaking(false);
            }, 500);
          },
        });
        setSttConnected(true);
        
        if (sttClient.current.stream) {
          setupAudioVisualizer(sttClient.current.stream);
        }
      } catch (sttError) {
        console.error('STT connection error:', sttError);
        const errorMessage = sttError instanceof Error 
          ? sttError.message 
          : 'Failed to connect to speech recognition. Please check microphone permissions.';
        setConnectionError(errorMessage);
      }

      // Initialize audio recorder
      audioRecorder.current = new AudioRecorder();
      if (sttClient.current.stream) {
        audioRecorder.current.start(sttClient.current.stream);
      }

      setIsRecording(true);
      setState('active');
    } catch (err) {
      console.error('Failed to start application:', err);
      setError('Failed to start. Please try again.');
      setState('error');
    }
  };

  // Save files to localStorage for future applications (does NOT update current state)
  const saveFilesToLocalStorage = (files: CandidateFile[]) => {
    try {
      const filesToSave: SavedFile[] = files.map(f => ({
        name: f.filename,
        type: f.fileType,
        sizeBytes: f.fileSizeBytes || 1, // Default to 1 if unknown
        cloudinaryUrl: f.cloudinaryUrl || '',
        cloudinaryPublicId: f.cloudinaryPublicId || '',
        savedAt: Date.now(),
      }));
      
      // Get existing from localStorage (not from state, to avoid race conditions)
      let existing: SavedFile[] = [];
      try {
        const stored = localStorage.getItem(SAVED_FILES_KEY);
        if (stored) existing = JSON.parse(stored);
      } catch { /* ignore */ }
      
      // Merge avoiding duplicates by URL
      const existingFiltered = existing.filter(sf => 
        !filesToSave.some(nf => nf.cloudinaryUrl === sf.cloudinaryUrl)
      );
      const merged = [...existingFiltered, ...filesToSave];
      
      localStorage.setItem(SAVED_FILES_KEY, JSON.stringify(merged));
      // Don't update savedFiles state - these are for future sessions only
    } catch (e) {
      console.warn('Failed to save files to localStorage:', e);
    }
  };

  // Use a saved file from localStorage
  const useSavedFile = async (savedFile: SavedFile) => {
    if (!sessionToken) return;
    
    try {
      // Register the file with the backend
      await registerCandidateFile(sessionToken, {
        filename: savedFile.name,
        fileType: savedFile.type,
        fileSizeBytes: savedFile.sizeBytes || 1, // Use saved size, default to 1
        cloudinaryUrl: savedFile.cloudinaryUrl,
        cloudinaryPublicId: savedFile.cloudinaryPublicId,
      });
      
      // Add to uploaded files list (minimal info for display)
      const newFile: CandidateFile = {
        id: `saved-${Date.now()}`,
        sessionId: sessionToken,
        filename: savedFile.name,
        fileType: savedFile.type,
        fileSizeBytes: 0,
        cloudinaryUrl: savedFile.cloudinaryUrl,
        cloudinaryPublicId: savedFile.cloudinaryPublicId,
        extractedText: null,
        status: 'processing',
        uploadedAt: new Date().toISOString(),
      };
      setUploadedFiles(prev => [...prev, newFile]);
      setSelectedSavedFiles(prev => {
        const newSet = new Set(prev);
        newSet.add(savedFile.cloudinaryUrl);
        return newSet;
      });
    } catch (err) {
      console.error('Failed to use saved file:', err);
    }
  };

  // Handle send - user clicked checkmark to send their response
  const handleSend = useCallback(() => {
    // Guard: Don't send if STT isn't connected
    if (!sttConnected) {
      setConnectionError('Voice recognition is still connecting. Please wait a moment.');
      return;
    }
    
    const currentTranscript = accumulatedTranscriptRef.current || partialTranscript || transcript;
    
    // Guard: Don't send empty content
    if (!currentTranscript.trim()) {
      setConnectionError('No speech detected. Please speak clearly and try again.');
      return;
    }
    
    if (currentTranscript.trim()) {
      const trimmedTranscript = currentTranscript.trim();
      
      // Check if adding to a previous response
      if (isAddingToHistory && selectedHistoryIndex !== null) {
        // Find the selected history item and append to it
        setConversationHistory(prev => {
          const updated = [...prev];
          const item = updated[selectedHistoryIndex];
          if (item && item.role === 'candidate') {
            updated[selectedHistoryIndex] = {
              ...item,
              content: item.content + ' ' + trimmedTranscript,
            };
          } else {
            // Add as new addition linked to that question
            updated.push({
              id: `candidate-addition-${Date.now()}`,
              role: 'candidate',
              content: trimmedTranscript,
              questionIndex: item?.questionIndex ?? currentIndex,
              timestamp: Date.now(),
              isAddition: true,
            });
          }
          return updated;
        });
        
        // Send with isAddition flag - backend will merge with previous message
        wsClient.current?.sendTranscript(trimmedTranscript, true);
        
        // After submitting addition, restore the saved transcript for current question
        if (savedTranscriptRef.current) {
          // Use setTimeout to restore after current render cycle
          setTimeout(() => {
            if (savedTranscriptRef.current) {
              setTranscript(savedTranscriptRef.current.transcript);
              setPartialTranscript(savedTranscriptRef.current.partialTranscript);
              accumulatedTranscriptRef.current = savedTranscriptRef.current.accumulatedTranscript;
              savedTranscriptRef.current = null;
            }
          }, 100);
        }
        
        setIsAddingToHistory(false);
        setSelectedHistoryIndex(null);
        return; // Early return - don't clear transcripts below
      } else {
        // Normal send - add to history
        const historyItem: ConversationItem = {
          id: `candidate-${Date.now()}`,
          role: 'candidate',
          content: trimmedTranscript,
          questionIndex: currentIndex,
          timestamp: Date.now(),
        };
        setConversationHistory(prev => [...prev, historyItem]);
        
        // Show loading state while waiting for AI response
        // Clear aiMessage so previous question doesn't flash
        setAiMessage('');
        setIsWaitingForAi(true);
        
        // IMPORTANT: Set ignore flag BEFORE muting to catch any late transcripts
        ignoreTranscriptsRef.current = true;
        
        // Immediately mute STT when waiting for AI
        sttClient.current?.mute();
        setIsRecording(false);
        
        // Send the transcript to backend
        wsClient.current?.sendTranscript(trimmedTranscript);
      }
      
      // Clear all transcript states
      setTranscript('');
      setPartialTranscript('');
      accumulatedTranscriptRef.current = '';
      currentUtteranceRef.current = '';
    }
    
    setIsSpeaking(false);
    
    // Clear any pending speech timeout
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
  }, [partialTranscript, transcript, isAddingToHistory, selectedHistoryIndex, currentIndex, sttConnected]);

  // Toggle mic
  const toggleMic = () => {
    if (isRecording) {
      sttClient.current?.mute();
      setIsRecording(false);
    } else {
      sttClient.current?.unmute();
      setIsRecording(true);
    }
  };

  // End interview
  const endInterview = () => {
    console.log('[Interview] Ending interview...');
    // Immediately set state to prevent further interactions
    setState('ended');
    // Then notify the server
    wsClient.current?.endInterview();
  };

  // Group conversation history into Q&A pairs
  const qaPairs = useMemo(() => {
    const pairs: { question: ConversationItem; answer?: ConversationItem; pairIndex: number }[] = [];
    let currentQuestion: ConversationItem | null = null;
    
    conversationHistory.forEach((item) => {
      if (item.role === 'ai') {
        // Start a new pair with this question
        if (currentQuestion) {
          // Previous question had no answer
          pairs.push({ question: currentQuestion, pairIndex: pairs.length });
        }
        currentQuestion = item;
      } else if (item.role === 'candidate' && currentQuestion) {
        // Complete the pair
        pairs.push({ question: currentQuestion, answer: item, pairIndex: pairs.length });
        currentQuestion = null;
      }
    });
    
    // Add any remaining unanswered question
    if (currentQuestion) {
      pairs.push({ question: currentQuestion, pairIndex: pairs.length });
    }
    
    return pairs;
  }, [conversationHistory]);

  // Get the currently displayed Q&A pair
  const displayedPair = selectedHistoryIndex !== null
    ? qaPairs[selectedHistoryIndex]
    : null;

  // Navigate conversation history (conveyor belt) - now uses Q&A pairs
  const scrollHistoryUp = useCallback(() => {
    if (qaPairs.length === 0) return;
    setSelectedHistoryIndex(prev => {
      if (prev === null) return qaPairs.length - 1;
      return Math.max(0, prev - 1);
    });
  }, [qaPairs.length]);

  const scrollHistoryDown = useCallback(() => {
    if (qaPairs.length === 0) return;
    setSelectedHistoryIndex(prev => {
      if (prev === null) return 0;
      if (prev >= qaPairs.length - 1) {
        // Back to current (no selection)
        return null;
      }
      return prev + 1;
    });
  }, [qaPairs.length]);

  // Select a history item to add to (now selects a Q&A pair)
  const selectHistoryItem = useCallback((index: number) => {
    // Save current transcript state before entering add mode
    // This preserves what the user already said for the current question
    savedTranscriptRef.current = {
      transcript: transcript,
      partialTranscript: partialTranscript,
      accumulatedTranscript: accumulatedTranscriptRef.current,
    };
    
    // Clear ALL transcript states for the addition - new speech is for the previous response
    // Important: Clear refs BEFORE state to prevent race conditions with STT callbacks
    accumulatedTranscriptRef.current = '';
    currentUtteranceRef.current = '';
    
    // Clear the display states synchronously
    setTranscript('');
    setPartialTranscript('');
    
    // Clear any pending speech detection
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    setIsSpeaking(false);
    
    setSelectedHistoryIndex(index);
    setIsAddingToHistory(true);
  }, [transcript, partialTranscript]);

  // Cancel adding to history - restore the saved transcript
  const cancelHistoryAdd = useCallback(() => {
    // Restore saved transcript state
    if (savedTranscriptRef.current) {
      setTranscript(savedTranscriptRef.current.transcript);
      setPartialTranscript(savedTranscriptRef.current.partialTranscript);
      accumulatedTranscriptRef.current = savedTranscriptRef.current.accumulatedTranscript;
      savedTranscriptRef.current = null;
    }
    
    setSelectedHistoryIndex(null);
    setIsAddingToHistory(false);
  }, []);

  // Cleanup
  const cleanup = () => {
    sttClient.current?.disconnect();
    wsClient.current?.disconnect();
    // Clear timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    // Reset connection states
    setWsConnected(false);
    setSttConnected(false);
    // Note: audioRecorder.stop() is called before cleanup in onInterviewEnded
  };

  // Audio visualizer setup
  const setupAudioVisualizer = useCallback((stream: MediaStream) => {
    try {
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 32;
      analyserRef.current.smoothingTimeConstant = 0.8;
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      
      const updateLevels = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Sample 5 frequency bands and normalize to 0-1
        const bands = [
          dataArray[1] / 255,
          dataArray[3] / 255,
          dataArray[5] / 255,
          dataArray[7] / 255,
          dataArray[9] / 255,
        ];
        
        setAudioLevels(bands);
        animationFrameRef.current = requestAnimationFrame(updateLevels);
      };
      
      updateLevels();
    } catch (err) {
      console.error('Audio visualizer setup failed:', err);
    }
  }, []);

  // Smooth text animation for AI messages - SLOW, readable pace
  useEffect(() => {
    // Don't animate while streaming or if no message
    if (!aiMessage || isAiStreaming) {
      return;
    }
    
    // Clear any previous animation
    if (textAnimationRef.current) {
      clearTimeout(textAnimationRef.current);
      textAnimationRef.current = null;
    }
    
    // When streaming ends, animate the final message word by word
    const words = aiMessage.split(' ').filter(w => w.length > 0);
    
    // Skip animation if message is very short
    if (words.length <= 2) {
      setDisplayedWords(words);
      setIsAnimatingText(false);
      return;
    }
    
    setDisplayedWords([]);
    setIsAnimatingText(true);
    
    let index = 0;
    const animateWord = () => {
      if (index < words.length) {
        setDisplayedWords(prev => [...prev, words[index]]);
        index++;
        // SLOW pace - 100ms per word for gentle, readable reveal
        textAnimationRef.current = setTimeout(animateWord, 100);
      } else {
        setIsAnimatingText(false);
        textAnimationRef.current = null;
      }
    };
    
    // Small delay before starting animation
    textAnimationRef.current = setTimeout(animateWord, 100);
    
    return () => {
      if (textAnimationRef.current) {
        clearTimeout(textAnimationRef.current);
        textAnimationRef.current = null;
      }
    };
  }, [aiMessage, isAiStreaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (textAnimationRef.current) {
        clearTimeout(textAnimationRef.current);
      }
    };
  }, []);

  // Format time display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate remaining time
  const remainingSeconds = timeLimitMinutes ? Math.max(0, timeLimitMinutes * 60 - elapsedSeconds) : null;
  const isTimeWarning = remainingSeconds !== null && remainingSeconds <= 60; // Last minute warning

  // Handle file upload
  const handleFileUploaded = (file: CandidateFile) => {
    setUploadedFiles((prev) => [...prev, file]);
  };

  // Voice Mode Handler for ending the voice session
  // IMPORTANT: These hooks must be before any early returns to maintain hook order
  const handleVoiceEnd = useCallback(() => {
    endInterview();
  }, [endInterview]);

  // Voice Mode Handler for submitting current response
  const handleVoiceSubmit = useCallback(() => {
    handleSend();
  }, [handleSend]);

  // Voice Mode Handler for mute toggle - controls STT
  const handleVoiceMuteToggle = useCallback((muted: boolean) => {
    console.log('[VoiceMute] Toggle called:', { muted, hasSTT: !!sttClient.current, sttMuted: sttClient.current?.muted });
    if (muted) {
      sttClient.current?.mute();
      setIsRecording(false);
      console.log('[VoiceMute] Muted STT');
    } else {
      sttClient.current?.unmute();
      setIsRecording(true);
      console.log('[VoiceMute] Unmuted STT, isRecording=true');
    }
  }, []);

  // Update audioStream when recording starts/stops
  useEffect(() => {
    if (prewarmedStreamRef.current && isRecording) {
      setAudioStream(prewarmedStreamRef.current);
    } else {
      setAudioStream(null);
    }
  }, [isRecording]);

  // Error state
  if (state === 'error') {
    return (
      <div className="min-h-screen bg-[#faf8fc] flex items-center justify-center p-4">
        <div
          className="fixed inset-0 pointer-events-none opacity-30"
          style={{
            background:
              'radial-gradient(ellipse at top, rgba(196,181,253,0.3) 0%, transparent 50%)',
          }}
        />
        <div className="relative text-center max-w-md">
          <div className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center bg-red-50">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary mb-2">Unable to Start</h1>
          <p className="text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  // Loading/Ready state
  if (state === 'loading' || state === 'ready') {
    return (
      <div className="min-h-screen bg-[#faf8fc] flex items-center justify-center p-4">
        <div
          className="fixed inset-0 pointer-events-none opacity-30"
          style={{
            background:
              'radial-gradient(ellipse at top, rgba(196,181,253,0.3) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(254,243,199,0.3) 0%, transparent 50%)',
          }}
        />

        <div className="relative text-center max-w-md">
          <img src="/iconfigwork.png" alt="Figwork" className="h-16 w-16 mx-auto mb-6" />

          {state === 'loading' ? (
            <>
              <div className="w-8 h-8 border-2 border-primary-light border-t-primary rounded-full animate-spin mx-auto mb-4" />
              <p className="text-text-secondary">Preparing...</p>
            </>
          ) : applicationInfo?.mode === 'inquiry' ? (
            // Inquiry Mode Ready State
            <>
              <h1 className="text-2xl font-semibold text-text-primary mb-2">
                {applicationInfo?.templateName}
              </h1>
              <p className="text-text-secondary mb-8">
                Chat with our AI assistant
              </p>

              <button
                onClick={handleProceedToUpload}
                className="px-8 py-4 rounded-xl text-white font-medium text-lg transition-all duration-300 hover:shadow-glow hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
              >
                Start Conversation
              </button>

              <p className="text-xs text-text-muted mt-6 max-w-xs mx-auto">
                Ask questions, share information, or get help. You can end the conversation anytime.
              </p>
            </>
          ) : (
            // Application Mode Ready State
            <>
              <h1 className="text-2xl font-semibold text-text-primary mb-2">
                {applicationInfo?.templateName}
              </h1>
              <p className="text-text-secondary mb-8">
                {applicationInfo?.questionCount} questions • Voice application
              </p>

              <button
                onClick={handleProceedToUpload}
                className="px-8 py-4 rounded-xl text-white font-medium text-lg transition-all duration-300 hover:shadow-glow hover:-translate-y-0.5"
                style={{ background: 'var(--gradient-fig)' }}
              >
                Begin Application
              </button>

              <p className="text-xs text-text-muted mt-6 max-w-xs mx-auto">
                Make sure you're in a quiet environment. Your microphone will be used to capture
                your responses.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Upload step (when file upload is enabled)
  if (state === 'upload') {
    return (
      <div className="min-h-screen bg-[#faf8fc] flex items-center justify-center p-4">
        <div
          className="fixed inset-0 pointer-events-none opacity-30"
          style={{
            background:
              'radial-gradient(ellipse at top, rgba(196,181,253,0.3) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(254,243,199,0.3) 0%, transparent 50%)',
          }}
        />

        <div className="relative w-full max-w-lg">
          <div className="text-center mb-8">
            <img src="/iconfigwork.png" alt="Figwork" className="h-12 w-12 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-text-primary mb-2">
              Upload Your Documents
            </h1>
            <p className="text-text-secondary text-sm">
              Share your resume, portfolio, or any relevant files. The AI will use these to personalize your questions.
            </p>
          </div>

          {/* Saved files from previous applications (exclude files already uploaded in this session) */}
          {(() => {
            const currentUploadUrls = new Set(uploadedFiles.map(f => f.cloudinaryUrl));
            const availableSavedFiles = savedFiles.filter(f => !currentUploadUrls.has(f.cloudinaryUrl));
            
            if (availableSavedFiles.length === 0) return null;
            
            return (
              <div className="mb-6">
                <p className="text-sm text-text-secondary mb-3">Previously uploaded:</p>
                <div className="space-y-2">
                  {availableSavedFiles.map((file) => (
                    <button
                      key={file.cloudinaryUrl}
                      onClick={() => useSavedFile(file)}
                      disabled={selectedSavedFiles.has(file.cloudinaryUrl)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                        selectedSavedFiles.has(file.cloudinaryUrl)
                          ? "bg-[#f3e8ff] border-[#c4b5fd] text-[#6b6b80]"
                          : "bg-white border-[#e8e4f0] hover:border-[#c4b5fd]"
                      )}
                    >
                      <FileText className="w-5 h-5 text-[#a78bfa]" />
                      <span className="flex-1 truncate text-sm">{file.name}</span>
                      {selectedSavedFiles.has(file.cloudinaryUrl) ? (
                        <Check className="w-4 h-4 text-[#a78bfa]" />
                      ) : (
                        <span className="text-xs text-[#a78bfa]">Use</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Upload new files */}
          {fileUploadConfig && sessionToken && (
            <div className="mb-6">
              {(() => {
                const currentUploadUrls = new Set(uploadedFiles.map(f => f.cloudinaryUrl));
                const hasAvailableSavedFiles = savedFiles.some(f => !currentUploadUrls.has(f.cloudinaryUrl));
                return hasAvailableSavedFiles ? (
                  <p className="text-sm text-text-secondary mb-3">Or upload new:</p>
                ) : null;
              })()}
              <FileUploadZone
                sessionToken={sessionToken}
                maxFiles={fileUploadConfig.maxFiles}
                maxFileSizeMb={fileUploadConfig.maxFileSizeMb}
                allowedFileTypes={fileUploadConfig.allowedFileTypes}
                uploadedFiles={uploadedFiles}
                onFileUploaded={(file) => {
                  handleFileUploaded(file);
                  saveFilesToLocalStorage([file]);
                }}
                inline
              />
            </div>
          )}

          {/* Continue button */}
          <div className="flex gap-3">
            <button
              onClick={() => startApplication()}
              className="flex-1 px-6 py-3 rounded-xl text-white font-medium transition-all duration-300 hover:shadow-glow hover:-translate-y-0.5"
              style={{ background: 'var(--gradient-fig)' }}
            >
              {uploadedFiles.length > 0 || selectedSavedFiles.size > 0 
                ? 'Continue' 
                : 'Skip & Continue'}
            </button>
          </div>

          <p className="text-xs text-text-muted mt-4 text-center">
            You can skip this step, but uploading files helps the AI ask more relevant questions.
          </p>
        </div>
      </div>
    );
  }

  // Ended state
  if (state === 'ended') {
    return (
      <div className="min-h-screen bg-[#faf8fc] flex items-center justify-center p-4">
        <div
          className="fixed inset-0 pointer-events-none opacity-30"
          style={{
            background:
              'radial-gradient(ellipse at top, rgba(196,181,253,0.3) 0%, transparent 50%)',
          }}
        />
        <div className="relative text-center max-w-md">
          <div
            className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
            style={{ background: 'var(--gradient-fig)' }}
          >
            <Check className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary mb-2">Application Complete</h1>
          <p className="text-text-secondary">
            Thank you for your time! The team will review your responses.
          </p>
        </div>
      </div>
    );
  }

  // Active interview state - Voice Mode
  if (enableVoiceOutput && state === 'active') {
    return (
      <VoiceMode
        isActive={state === 'active'}
        isSpeaking={isSpeaking}
        voiceId={voiceId}
        currentQuestion={aiMessage}
        isMessageComplete={!isAiStreaming}
        transcript={transcript}
        partialTranscript={partialTranscript}
        currentIndex={currentIndex}
        totalQuestions={totalQuestions}
        elapsedSeconds={elapsedSeconds}
        timeLimitMinutes={timeLimitMinutes}
        isWaitingForAi={isWaitingForAi}
        onEnd={handleVoiceEnd}
        onSubmit={handleVoiceSubmit}
        onMuteToggle={handleVoiceMuteToggle}
        audioStream={audioStream}
      />
    );
  }

  // Active interview state - Text Mode
  return (
    <div className="min-h-screen bg-[#faf8fc] flex flex-col">
      {/* Soft gradient background overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-30"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(196,181,253,0.3) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(254,243,199,0.3) 0%, transparent 50%)',
        }}
      />

      {/* Header */}
      <header className="relative h-14 sm:h-16 px-4 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-3">
          <img src="/iconfigwork.png" alt="Figwork" className="h-6 w-6 sm:h-8 sm:w-8" />
          {/* Connection status indicators */}
          <div className="flex items-center gap-3">
            {/* WebSocket status */}
            <div className="flex items-center gap-1.5" title="Server connection">
              <div className={cn(
                'w-2 h-2 rounded-full transition-colors',
                wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
              )} />
              <span className="text-xs text-[#a0a0b0] hidden sm:inline">Server</span>
            </div>
            {/* STT status */}
            <div className="flex items-center gap-1.5" title="Speech recognition">
              <div className={cn(
                'w-2 h-2 rounded-full transition-colors',
                sttConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              )} />
              <span className="text-xs text-[#a0a0b0] hidden sm:inline">Voice</span>
            </div>
          </div>
        </div>
        
        {/* Center: Timer */}
        {timeLimitMinutes && remainingSeconds !== null && (
          <div className={cn(
            'flex items-center gap-2 px-4 py-1.5 rounded-full transition-colors',
            isTimeWarning 
              ? 'bg-red-50 text-red-600' 
              : 'bg-white/80 text-[#6b6b80]'
          )}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className={cn(
              'text-sm font-medium tabular-nums',
              isTimeWarning && 'animate-pulse'
            )}>
              {formatTime(remainingSeconds)}
            </span>
          </div>
        )}
        
        {/* Right: Question progress */}
        <span className="text-sm text-[#a0a0b0] font-medium">
          {currentIndex + 1} / {totalQuestions}
        </span>
      </header>

      {/* Main Content */}
      <main className="relative flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-4 sm:py-8">
        {/* Conversation Conveyor Belt */}
        <div className="max-w-2xl w-full mb-4 sm:mb-8">
          {/* History navigation buttons */}
          {qaPairs.length > 0 && (
            <div className="flex justify-center mb-3">
              <div className="flex items-center gap-2 bg-white/60 rounded-full px-3 py-1.5 shadow-sm">
                <button
                  onClick={scrollHistoryUp}
                  disabled={selectedHistoryIndex === 0}
                  className={cn(
                    'p-1 rounded-full transition-all',
                    selectedHistoryIndex === 0 
                      ? 'opacity-30 cursor-not-allowed' 
                      : 'hover:bg-[#c4b5fd]/20 text-[#6b6b80]'
                  )}
                  title="Previous Q&A"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <span className="text-xs text-[#a0a0b0] min-w-[60px] text-center">
                  {selectedHistoryIndex !== null 
                    ? `Q${selectedHistoryIndex + 1}/${qaPairs.length}` 
                    : 'Current'}
                </span>
                <button
                  onClick={scrollHistoryDown}
                  disabled={selectedHistoryIndex === null}
                  className={cn(
                    'p-1 rounded-full transition-all',
                    selectedHistoryIndex === null 
                      ? 'opacity-30 cursor-not-allowed' 
                      : 'hover:bg-[#c4b5fd]/20 text-[#6b6b80]'
                  )}
                  title="Next Q&A"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Message Card - Scrollable for long content */}
          <div
            ref={historyContainerRef}
            className={cn(
              "relative p-6 rounded-2xl backdrop-blur-sm transition-all duration-200",
              isAddingToHistory 
                ? "bg-[#fef3c7]/70 border-2 border-amber-300" 
                : "bg-white/70",
              selectedHistoryIndex !== null && "ring-2 ring-[#c4b5fd]/50"
            )}
            style={{
              boxShadow: '0 2px 16px rgba(0, 0, 0, 0.04)',
              border: isAddingToHistory ? undefined : '1px solid rgba(0, 0, 0, 0.06)',
            }}
          >
            {/* Adding to history indicator */}
            {isAddingToHistory && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 bg-amber-100 rounded-full text-xs text-amber-700 font-medium z-10">
                <Plus className="w-3 h-3" />
                Adding to previous response
                <button onClick={cancelHistoryAdd} className="ml-1 hover:text-amber-900" title="Cancel and return to current question">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Scrollable content area */}
            <div className="overflow-y-auto max-h-[280px] scrollbar-thin scrollbar-thumb-[#c4b5fd]/30 scrollbar-track-transparent">
              {/* Show Q&A pair if selected from history */}
              {selectedHistoryIndex !== null && displayedPair ? (
                <div className="space-y-4">
                  {/* Question - italic, lighter */}
                  <p className="text-base md:text-lg italic text-[#6b6b7b] leading-relaxed text-center whitespace-pre-wrap break-words">
                    {displayedPair.question.content}
                  </p>
                  {/* Answer - bold, darker */}
                  {displayedPair.answer ? (
                    <div>
                      <p className="text-lg md:text-xl font-semibold text-[#1f1f2e] leading-relaxed text-center whitespace-pre-wrap break-words">
                        {displayedPair.answer.content}
                      </p>
                      {/* Add-to button for the answer */}
                      {!isAddingToHistory && (
                        <button
                          onClick={() => selectHistoryItem(selectedHistoryIndex)}
                          className="block mx-auto mt-4 text-sm text-[#a78bfa] hover:text-[#7c3aed] transition-colors"
                        >
                          + Add more to this response
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-base text-[#a0a0b0] text-center italic">No response yet</p>
                  )}
                </div>
              ) : (
                <p className="text-lg md:text-xl font-medium text-[#1f1f2e] leading-relaxed text-center whitespace-pre-wrap break-words">
                  {isWaitingForAi ? (
                    // Waiting state - just a blinking vertical cursor
                    <span className="inline-block w-0.5 h-6 bg-[#a78bfa] animate-pulse rounded-sm" />
                  ) : aiMessage ? (
                    // Show message - with cursor if still streaming
                    <span className="inline-flex items-center">
                      <span>{aiMessage}</span>
                      {isAiStreaming && (
                        <span className="inline-block w-0.5 h-5 ml-1 bg-[#a78bfa] animate-pulse rounded-sm" />
                      )}
                    </span>
                  ) : (
                    // No message yet - show subtle cursor
                    <span className="inline-block w-0.5 h-6 bg-[#c4b5fd]/50 animate-pulse rounded-sm" />
                  )}
                </p>
              )}
            </div>
          </div>
          
          {/* Mini history preview (dots) - One dot per Q&A pair */}
          {qaPairs.length > 0 && (
            <div className="flex justify-center gap-2 mt-3">
              {qaPairs.slice(-5).map((pair, i) => {
                const actualIndex = Math.max(0, qaPairs.length - 5) + i;
                const isSelected = selectedHistoryIndex === actualIndex;
                const isComplete = !!pair.answer;
                const isLatest = actualIndex === qaPairs.length - 1;
                
                // Don't show the latest pair while waiting for AI (if it has no answer)
                if (isLatest && !isComplete && isWaitingForAi) {
                  return null;
                }
                
                return (
                  <button
                    key={pair.question.id}
                    onClick={() => setSelectedHistoryIndex(actualIndex)}
                    className={cn(
                      "w-2.5 h-2.5 rounded-full transition-all",
                      // Purple/green gradient for complete pairs, just purple for questions only
                      isComplete 
                        ? 'bg-gradient-to-br from-[#c4b5fd] to-emerald-400' 
                        : 'bg-[#c4b5fd]',
                      isSelected 
                        ? 'scale-150 ring-2 ring-offset-2 ring-[#a78bfa]' 
                        : 'opacity-60 hover:opacity-100 hover:scale-110'
                    )}
                    title={`Q${actualIndex + 1}: ${pair.question.content.slice(0, 30)}...`}
                  />
                );
              })}
              {/* Current indicator - show loading if waiting */}
              {selectedHistoryIndex === null && (
                isWaitingForAi || isAiStreaming ? (
                  <div className="w-2.5 h-2.5 rounded-full bg-[#a78bfa] animate-pulse scale-150" title="Processing..." />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full bg-[#1f1f2e] scale-150" title="Current" />
                )
              )}
            </div>
          )}
        </div>

        {/* Live Transcript Display - Scrollable for long responses */}
        <div className="max-w-2xl w-full px-4">
          <div className="max-h-[150px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#c4b5fd]/30 scrollbar-track-transparent">
            <p className="font-mono text-base text-center min-h-[3rem] leading-relaxed transition-all duration-150">
              {/* Show connection status or transcript */}
              {!sttConnected ? (
                <span className="text-amber-500 animate-pulse">
                  Connecting to voice recognition...
                </span>
              ) : isAddingToHistory && displayedPair?.answer ? (
                // Show previous answer + new transcript when adding to response
                <>
                  <span className="text-[#9ca3af]">{displayedPair.answer.content}</span>
                  {(partialTranscript || transcript) && (
                    <>
                      <span className="text-[#9ca3af]"> + </span>
                      <span className="text-[#1f1f2e] font-semibold">{partialTranscript || transcript}</span>
                    </>
                  )}
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-[#c4b5fd] animate-pulse rounded-sm align-middle" />
                </>
              ) : partialTranscript?.includes('...') ? (
                <span className="text-[#a78bfa] animate-pulse">
                  {partialTranscript}
                </span>
              ) : partialTranscript ? (
                // Show accumulated text with cursor
                <>
                  <span className="text-[#1f1f2e]">{partialTranscript}</span>
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-[#c4b5fd] animate-pulse rounded-sm align-middle" />
                </>
              ) : transcript ? (
                // Show final transcript
                <span className="text-[#1f1f2e]">{transcript}</span>
              ) : (
                <span className="text-[#c4b5fd]">Start speaking...</span>
              )}
            </p>
          </div>
        </div>

        {/* Connection Error Toast - Top of screen to avoid overlap */}
        {connectionError && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-md flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{connectionError}</span>
            <button
              onClick={() => setConnectionError(null)}
              className="p-1 hover:bg-red-100 rounded ml-1"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </main>

      {/* Controls - Bottom */}
      <footer className="relative pb-8 sm:pb-12 flex flex-col items-center gap-4 sm:gap-6">
        {/* Audio Visualizer */}
        <div className="flex items-end justify-center gap-1 h-6 sm:h-8">
          {audioLevels.map((level, i) => (
            <div
              key={i}
              className="w-1 bg-[#a78bfa] rounded-full transition-all duration-75"
              style={{
                height: `${Math.max(4, level * 32)}px`,
                opacity: isRecording ? 0.4 + level * 0.6 : 0.2,
              }}
            />
          ))}
        </div>

        {/* Mic Button - Simple design */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={toggleMic}
            className={cn(
              'w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all duration-200',
              isRecording 
                ? 'bg-[#a78bfa] shadow-lg' 
                : 'bg-white border border-[#e5e5e5] hover:border-[#a78bfa]'
            )}
          >
            <svg
              className={cn(
                'w-6 h-6 transition-colors',
                isRecording ? 'text-white' : 'text-[#666]'
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          </button>

          {/* Send Button - Only visible when there's actual transcript to send */}
          <button
            onClick={handleSend}
            disabled={!sttConnected || (!transcript && !accumulatedTranscriptRef.current)}
            className={cn(
              'w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200',
              'bg-[#10b981] text-white',
              'hover:bg-[#059669] active:scale-95',
              // Only show when we have actual text to send (not just "isSpeaking")
              (transcript || partialTranscript)
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none',
              // Dim when disabled
              (!sttConnected) && 'opacity-50 cursor-not-allowed'
            )}
            aria-label="Send response"
          >
            <Check className="w-5 h-5" />
          </button>
        </div>

        <span className="text-sm text-[#888] font-medium">
          {(isSpeaking || partialTranscript || transcript) ? 'Tap ✓ to send your response' : isRecording ? 'Listening...' : 'Tap to speak'}
        </span>

        {/* File Upload Button (if enabled) */}
        {fileUploadConfig?.allowFileUpload && (
          <button
            onClick={() => setShowUploadZone(!showUploadZone)}
            className="flex items-center gap-2 px-5 py-2.5 text-sm text-[#6b6b80] hover:text-[#1f1f2e] bg-white/80 backdrop-blur-sm rounded-full border border-[#e8e4f0] hover:border-[#c4b5fd] transition-all duration-300 hover:shadow-soft-sm"
          >
            <Paperclip className="w-4 h-4" />
            <span>Share a file</span>
            {uploadedFiles.length > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs text-[#a78bfa] bg-[#c4b5fd]/20 rounded-full">
                {uploadedFiles.length}
              </span>
            )}
          </button>
        )}

        {/* End Interview */}
        <button
          onClick={endInterview}
          className="text-sm text-[#c4b5fd] hover:text-[#a78bfa] transition-colors"
        >
          End interview
        </button>
      </footer>

      {/* File Upload Zone (if shown) */}
      {showUploadZone && sessionToken && fileUploadConfig?.allowFileUpload && (
        <FileUploadZone
          sessionToken={sessionToken}
          maxFiles={fileUploadConfig.maxFiles}
          maxFileSizeMb={fileUploadConfig.maxFileSizeMb}
          allowedFileTypes={fileUploadConfig.allowedFileTypes}
          uploadedFiles={uploadedFiles}
          onFileUploaded={handleFileUploaded}
          onClose={() => setShowUploadZone(false)}
        />
      )}
    </div>
  );
}
