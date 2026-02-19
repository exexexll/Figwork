'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, PhoneOff, ArrowUp, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { createTTSClient, ElevenLabsTTSClient } from '@/lib/elevenlabs-tts';
import { getTTSClient, RealtimeTTSClient } from '@/lib/realtime-tts';
import type { OpenAIVoice } from '@/lib/types';

interface VoiceModeProps {
  isActive: boolean;
  isSpeaking: boolean;
  voiceId: OpenAIVoice;
  currentQuestion: string;
  isMessageComplete: boolean; // Only speak when message streaming is done
  transcript: string;
  partialTranscript: string;
  currentIndex: number;
  totalQuestions: number;
  elapsedSeconds: number;
  timeLimitMinutes: number | null;
  isWaitingForAi: boolean;
  onEnd: () => void;
  onSubmit: () => void;
  onMuteToggle: (muted: boolean) => void;
  audioStream?: MediaStream | null;
}

// Circular Orb Visualizer with light background
function OrbVisualizer({
  audioLevel,
  isActive,
  mode,
}: {
  audioLevel: number;
  isActive: boolean;
  mode: 'ai' | 'user' | 'idle' | 'processing';
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const smoothLevelRef = useRef(0);
  const phaseRef = useRef(0);

  const colors = useMemo(() => {
    switch (mode) {
      case 'ai': return { primary: '#8b5cf6', secondary: '#c4b5fd', glow: 'rgba(139, 92, 246, 0.3)' };
      case 'user': return { primary: '#10b981', secondary: '#6ee7b7', glow: 'rgba(16, 185, 129, 0.3)' };
      case 'processing': return { primary: '#f59e0b', secondary: '#fcd34d', glow: 'rgba(245, 158, 11, 0.3)' };
      default: return { primary: '#94a3b8', secondary: '#cbd5e1', glow: 'rgba(148, 163, 184, 0.2)' };
    }
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 200;
    canvas.width = size * 2;
    canvas.height = size * 2;
    ctx.scale(2, 2); // Retina

    const centerX = size / 2;
    const centerY = size / 2;
    const baseRadius = 50;

    const animate = () => {
      // Smooth the audio level with asymmetric attack/decay
      const targetLevel = isActive ? audioLevel : 0;
      const diff = targetLevel - smoothLevelRef.current;
      // Faster attack (0.25), slower decay (0.08) for smoother pauses
      const smoothingFactor = diff > 0 ? 0.25 : 0.08;
      smoothLevelRef.current += diff * smoothingFactor;
      // Clamp very small values to 0 to prevent endless tiny animations
      const level = smoothLevelRef.current < 0.01 ? 0 : smoothLevelRef.current;

      phaseRef.current += 0.02;

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Outer glow
      const glowRadius = baseRadius + 20 + level * 30;
      const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.5, centerX, centerY, glowRadius);
      gradient.addColorStop(0, colors.glow);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Main orb with wobble
      const points = 64;
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const wobble = Math.sin(angle * 3 + phaseRef.current) * level * 8 +
                       Math.sin(angle * 5 + phaseRef.current * 1.5) * level * 4;
        const radius = baseRadius + level * 15 + wobble;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Fill with gradient
      const orbGradient = ctx.createRadialGradient(
        centerX - baseRadius * 0.3,
        centerY - baseRadius * 0.3,
        0,
        centerX,
        centerY,
        baseRadius + level * 20
      );
      orbGradient.addColorStop(0, colors.secondary);
      orbGradient.addColorStop(0.7, colors.primary);
      orbGradient.addColorStop(1, colors.primary);
      ctx.fillStyle = orbGradient;
      ctx.fill();

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, audioLevel, colors]);

  return (
    <div className="relative w-[200px] h-[200px]">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ width: 200, height: 200 }}
      />
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function VoiceMode({
  isActive,
  isSpeaking,
  voiceId,
  currentQuestion,
  isMessageComplete,
  transcript,
  partialTranscript,
  currentIndex,
  totalQuestions,
  elapsedSeconds,
  timeLimitMinutes,
  isWaitingForAi,
  onEnd,
  onSubmit,
  onMuteToggle,
  audioStream,
}: VoiceModeProps) {
  const [userAudioLevel, setUserAudioLevel] = useState(0);
  const [aiAudioLevel, setAiAudioLevel] = useState(0);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [ttsReady, setTtsReady] = useState(false);
  
  const ttsClientRef = useRef<ElevenLabsTTSClient | RealtimeTTSClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastSpokenRef = useRef<string>('');
  const isMutedRef = useRef(true); // Ref to avoid stale closures
  const speechQueueRef = useRef<string[]>([]); // Queue for messages to speak
  const isSpeakingRef = useRef(false); // Track if currently speaking TTS
  const pendingSpeechRef = useRef(false); // Track pending speech (ref for sync)

  const remainingSeconds = timeLimitMinutes 
    ? Math.max(0, timeLimitMinutes * 60 - elapsedSeconds)
    : null;
  const isTimeWarning = remainingSeconds !== null && remainingSeconds < 60;

  // Helper to speak next item in queue
  const speakNext = useCallback(() => {
    if (speechQueueRef.current.length === 0 || isSpeakingRef.current) {
      return;
    }
    
    const nextText = speechQueueRef.current.shift();
    if (!nextText || !ttsClientRef.current) return;
    
    console.log('[VoiceMode] Speaking from queue:', nextText.slice(0, 40) + '...');
    isSpeakingRef.current = true;
    lastSpokenRef.current = nextText;
    ttsClientRef.current.speak(nextText);
  }, []);

  // Initialize TTS client
  useEffect(() => {
    console.log('[VoiceMode] Initializing TTS with voiceId:', voiceId);
    const elevenLabsClient = createTTSClient(voiceId);
    
    if (elevenLabsClient) {
      console.log('[VoiceMode] ✓ ElevenLabs TTS client created');
      ttsClientRef.current = elevenLabsClient;
      
      elevenLabsClient.onSpeakingStart = () => {
        console.log('[VoiceMode] TTS started - AI speaking');
        isSpeakingRef.current = true;
        pendingSpeechRef.current = false; // No longer pending, now active
        setIsAiSpeaking(true);
        // Muting handled by queueing logic, not here (avoid double-mute)
      };
      
      elevenLabsClient.onSpeakingEnd = () => {
        console.log('[VoiceMode] TTS ended');
        isSpeakingRef.current = false;
        setIsAiSpeaking(false);
        
        // Check if there's more to speak in the queue
        if (speechQueueRef.current.length > 0) {
          console.log('[VoiceMode] Queue has more items, speaking next');
          speakNext();
        } else {
          // No more to speak - unmute mic
          console.log('[VoiceMode] Queue empty - unmuting mic');
          pendingSpeechRef.current = false;
          setIsMuted(false);
          isMutedRef.current = false;
          onMuteToggle(false);
        }
      };
      
      elevenLabsClient.onAudioLevel = (level) => {
        // Only update if actually speaking (prevents stale level updates)
        if (isSpeakingRef.current) {
          setAiAudioLevel(level);
        }
      };
      
      elevenLabsClient.onError = (error) => {
        console.error('[VoiceMode] TTS Error:', error);
        // Reset all TTS state on error
        isSpeakingRef.current = false;
        pendingSpeechRef.current = false;
        speechQueueRef.current = []; // Clear queue
        setIsAiSpeaking(false);
        setAiAudioLevel(0);
        setIsMuted(false);
        isMutedRef.current = false;
        onMuteToggle(false);
      };
      
      setTtsReady(true);
      console.log('[VoiceMode] ✓ TTS ready');
    } else {
      console.log('[VoiceMode] Using Web Speech API (fallback)');
      const webSpeechClient = getTTSClient(voiceId);
      ttsClientRef.current = webSpeechClient;
      
      webSpeechClient.onSpeakingStart = () => {
        console.log('[VoiceMode] TTS started (WebSpeech)');
        isSpeakingRef.current = true;
        pendingSpeechRef.current = false;
        setIsAiSpeaking(true);
      };
      
      webSpeechClient.onSpeakingEnd = () => {
        console.log('[VoiceMode] TTS ended (WebSpeech)');
        isSpeakingRef.current = false;
        setIsAiSpeaking(false);
        
        // Check if there's more to speak
        if (speechQueueRef.current.length > 0) {
          speakNext();
        } else {
          pendingSpeechRef.current = false;
          setIsMuted(false);
          isMutedRef.current = false;
          onMuteToggle(false);
        }
      };
      
      webSpeechClient.onAudioLevel = (level) => {
        if (isSpeakingRef.current) {
          setAiAudioLevel(level);
        }
      };
      
      setTtsReady(true);
    }

    return () => {
      ttsClientRef.current?.destroy();
    };
  }, [voiceId, onMuteToggle, speakNext]);

  // Mute when waiting for AI (processing state) - SINGLE source of truth for processing mute
  useEffect(() => {
    if (isWaitingForAi && !isMutedRef.current) {
      console.log('[VoiceMode] Processing started - muting mic');
      setIsMuted(true);
      isMutedRef.current = true;
      onMuteToggle(true);
    }
    // NOTE: Unmuting is handled by TTS onSpeakingEnd or speech queue logic
  }, [isWaitingForAi, onMuteToggle]);
  
  // FAILSAFE: If mic stays muted too long without TTS activity, force unmute
  useEffect(() => {
    // Only activate failsafe when we have a message and not actively processing/speaking
    if (!currentQuestion || !isMessageComplete || isAiSpeaking || isWaitingForAi) {
      return;
    }
    
    // If pending speech, give it time to start
    if (pendingSpeechRef.current || speechQueueRef.current.length > 0) {
      return;
    }
    
    // 2 second failsafe - if muted but nothing happening, unmute
    const failsafeTimeout = setTimeout(() => {
      if (isMutedRef.current && !isSpeakingRef.current && !pendingSpeechRef.current) {
        console.log('[VoiceMode] FAILSAFE: Forcing unmute');
        pendingSpeechRef.current = false;
        speechQueueRef.current = [];
        setIsMuted(false);
        isMutedRef.current = false;
        onMuteToggle(false);
      }
    }, 2000);
    
    return () => clearTimeout(failsafeTimeout);
  }, [currentQuestion, isMessageComplete, isAiSpeaking, isWaitingForAi, onMuteToggle]);

  // Queue AI messages for speaking ONLY when complete (not while streaming)
  useEffect(() => {
    console.log('[VoiceMode] Speech queue check:', { 
      ttsReady, 
      hasCurrentQuestion: !!currentQuestion, 
      isMessageComplete,
      currentQuestionPreview: currentQuestion?.slice(0, 30) + '...'
    });
    
    // CRITICAL: Only speak when message is COMPLETE, not during streaming
    // This prevents speaking partial messages multiple times
    if (!ttsReady || !currentQuestion || !isMessageComplete) {
      console.log('[VoiceMode] Skipping speech - conditions not met');
      return;
    }

    const trimmedQuestion = currentQuestion.trim();
    if (!trimmedQuestion) {
      return;
    }

    // Normalize text for comparison (remove extra whitespace)
    const normalizedQuestion = trimmedQuestion.replace(/\s+/g, ' ');
    const normalizedLast = lastSpokenRef.current?.replace(/\s+/g, ' ') || '';
    
    // Check if this text is already queued or was just spoken (with normalization)
    const isAlreadyQueued = speechQueueRef.current.some(
      q => q.replace(/\s+/g, ' ') === normalizedQuestion
    );
    
    if (normalizedQuestion === normalizedLast || isAlreadyQueued) {
      console.log('[VoiceMode] Skipping duplicate:', normalizedQuestion.slice(0, 30) + '...');
      return;
    }

    console.log('[VoiceMode] Message complete, queueing for speech:', normalizedQuestion.slice(0, 50) + '...');
    
    // Mute mic before speaking (if not already muted)
    if (!isMutedRef.current) {
      setIsMuted(true);
      isMutedRef.current = true;
      onMuteToggle(true);
    }
    
    // Add to queue and mark pending
    speechQueueRef.current.push(trimmedQuestion);
    pendingSpeechRef.current = true;
    
    // Start speaking if not already
    if (!isSpeakingRef.current) {
      speakNext();
    }
  }, [currentQuestion, isMessageComplete, ttsReady, onMuteToggle, speakNext]);

  // Analyze user audio stream for visualization (only when not muted)
  useEffect(() => {
    if (!audioStream || !isActive || isMuted) {
      setUserAudioLevel(0);
      return;
    }

    try {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(audioStream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        if (!analyserRef.current || isMutedRef.current) {
          setUserAudioLevel(0);
          animationFrameRef.current = requestAnimationFrame(updateLevel);
          return;
        }
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setUserAudioLevel(average / 255);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        audioContext.close();
      };
    } catch (error) {
      console.error('Audio analysis error:', error);
    }
  }, [audioStream, isActive, isMuted]);

  const handleEndCall = useCallback(() => {
    ttsClientRef.current?.stop();
    onEnd();
  }, [onEnd]);

  const handleInterrupt = useCallback(() => {
    ttsClientRef.current?.stop();
    setIsAiSpeaking(false);
    setAiAudioLevel(0);
    setIsMuted(false);
    isMutedRef.current = false;
    onMuteToggle(false);
  }, [onMuteToggle]);

  const handleSubmit = useCallback(() => {
    ttsClientRef.current?.stop();
    setIsAiSpeaking(false);
    setIsMuted(true);
    isMutedRef.current = true;
    onMuteToggle(true);
    onSubmit();
  }, [onSubmit, onMuteToggle]);

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    isMutedRef.current = newMuted;
    onMuteToggle(newMuted);
  }, [isMuted, onMuteToggle]);

  // Only show actual speech in transcript box, not status messages like "Listening..."
  const isStatusMessage = partialTranscript === 'Listening...' || partialTranscript === 'Processing...';
  const displayText = isStatusMessage ? transcript : (partialTranscript || transcript);
  const hasTranscript = transcript.trim().length > 0;

  // Determine current mode using refs for accurate sync
  // Priority: processing > AI speaking > user speaking > idle
  const hasPending = pendingSpeechRef.current || speechQueueRef.current.length > 0;
  
  const vizMode = isWaitingForAi ? 'processing' : 
                  (isAiSpeaking || hasPending) ? 'ai' : 
                  (isSpeaking && !isMuted) ? 'user' :
                  'idle';

  // Audio level: show user audio when user mode, AI audio when AI speaking
  // Use 0.1 minimum during AI speaking to prevent visualizer from dropping
  const vizAudioLevel = isAiSpeaking ? Math.max(aiAudioLevel, 0.05) : 
                        (isSpeaking && !isMuted) ? userAudioLevel : 0;

  const statusText = isWaitingForAi ? 'Processing...' :
                     (isAiSpeaking || hasPending) ? 'Speaking...' : 
                     isMuted ? 'Tap mic to speak' :
                     isSpeaking ? 'Listening...' :
                     hasTranscript ? 'Tap ✓ to send' :
                     'Ready';
  
  const statusColor = vizMode === 'ai' ? 'text-violet-600' :
                      vizMode === 'user' ? 'text-emerald-600' :
                      vizMode === 'processing' ? 'text-amber-600' :
                      hasTranscript ? 'text-violet-500' :
                      'text-slate-400';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#faf8fc]">
      {/* Background gradient - same as text mode */}
      <div
        className="fixed inset-0 pointer-events-none opacity-40"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(196,181,253,0.4) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(254,243,199,0.4) 0%, transparent 50%)',
        }}
      />

      {/* Header */}
      <header className="relative h-14 px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/iconfigwork.png" alt="Figwork" className="h-6 w-6 sm:h-7 sm:w-7" />
          {totalQuestions > 0 && (
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalQuestions }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-1.5 h-1.5 rounded-full transition-all duration-300',
                    i < currentIndex 
                      ? 'bg-emerald-400' 
                      : i === currentIndex 
                      ? 'bg-violet-500 w-3' 
                      : 'bg-slate-300'
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {remainingSeconds !== null && (
          <div className={cn(
            'flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium',
            isTimeWarning 
              ? 'bg-red-50 text-red-600' 
              : 'bg-white/80 text-slate-500'
          )}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="font-mono">{formatTime(remainingSeconds)}</span>
          </div>
        )}

        <button
          onClick={handleEndCall}
          className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Orb Visualizer */}
        <div 
          className={cn(
            "relative cursor-pointer transition-transform hover:scale-105",
            isAiSpeaking && "cursor-pointer"
          )}
          onClick={isAiSpeaking ? handleInterrupt : undefined}
        >
          <OrbVisualizer
            audioLevel={vizAudioLevel}
            isActive={vizMode !== 'idle'}
            mode={vizMode}
          />
        </div>

        {/* Status */}
        <div className="mt-6 text-center">
          <span className={cn('text-sm font-medium', statusColor)}>
            {statusText}
          </span>
          {isAiSpeaking && (
            <p className="text-slate-400 text-xs mt-1">
              Tap orb to interrupt
            </p>
          )}
        </div>

        {/* Transcript display */}
        <div className="mt-8 w-full max-w-md px-4">
          {displayText ? (
            <div 
              className="bg-white/80 backdrop-blur-sm rounded-2xl px-5 py-4 border border-white/50 shadow-sm max-h-40 overflow-y-auto"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#cbd5e1 transparent',
              }}
            >
              <p className="text-slate-700 text-center text-[15px] leading-relaxed">
                {displayText}
                {isSpeaking && !isMuted && (
                  <span className="inline-block w-0.5 h-4 ml-0.5 bg-emerald-400 animate-pulse" />
                )}
              </p>
            </div>
          ) : currentQuestion && !isAiSpeaking ? (
            <p className="text-slate-400 text-center text-sm leading-relaxed px-4 line-clamp-3">
              {currentQuestion}
            </p>
          ) : null}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="relative px-6 py-6 flex items-center justify-center gap-4">
        {/* Mic toggle */}
        <button
          onClick={toggleMute}
          disabled={isAiSpeaking || isWaitingForAi}
          className={cn(
            'w-14 h-14 rounded-full flex items-center justify-center transition-all',
            'border-2 shadow-sm',
            isMuted 
              ? 'bg-white border-slate-200 text-slate-400' 
              : 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/30',
            (isAiSpeaking || isWaitingForAi) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        {/* Submit button */}
        {hasTranscript && !isWaitingForAi && !isAiSpeaking && (
          <button
            onClick={handleSubmit}
            className={cn(
              'w-14 h-14 rounded-full flex items-center justify-center',
              'bg-violet-500 hover:bg-violet-400 transition-all',
              'shadow-lg shadow-violet-500/30',
              'animate-in fade-in zoom-in-95 duration-200'
            )}
          >
            <ArrowUp className="w-6 h-6 text-white" strokeWidth={2.5} />
          </button>
        )}

        {/* End call button */}
        <button
          onClick={handleEndCall}
          className={cn(
            'w-14 h-14 rounded-full flex items-center justify-center',
            'bg-white border-2 border-slate-200 hover:border-red-300 hover:bg-red-50',
            'text-slate-400 hover:text-red-500 transition-all'
          )}
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
