/**
 * Real-time Text-to-Speech Client
 * Uses Web Speech API for now, can be upgraded to OpenAI TTS
 */

import type { OpenAIVoice } from './types';

interface TTSOptions {
  voice: OpenAIVoice;
  rate?: number;
  pitch?: number;
  volume?: number;
}

// Map OpenAI voices to system voice characteristics
const voiceCharacteristics: Record<OpenAIVoice, { gender: 'male' | 'female'; tone: string }> = {
  alloy: { gender: 'female', tone: 'neutral' },
  echo: { gender: 'male', tone: 'warm' },
  fable: { gender: 'male', tone: 'expressive' },
  onyx: { gender: 'male', tone: 'deep' },
  nova: { gender: 'female', tone: 'bright' },
  shimmer: { gender: 'female', tone: 'clear' },
};

export class RealtimeTTSClient {
  private synthesis: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private options: TTSOptions;
  private isReady = false;
  private audioQueue: string[] = [];
  private isSpeaking = false;
  
  // Callbacks
  onSpeakingStart: (() => void) | null = null;
  onSpeakingEnd: (() => void) | null = null;
  onAudioLevel: ((level: number) => void) | null = null;
  onError: ((error: string) => void) | null = null;

  constructor(options: TTSOptions) {
    this.options = {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      ...options,
    };
    
    if (typeof window !== 'undefined') {
      this.synthesis = window.speechSynthesis;
      this.loadVoices();
    }
  }

  private loadVoices() {
    if (!this.synthesis) return;

    // Voices may load asynchronously
    this.voices = this.synthesis.getVoices();
    
    if (this.voices.length === 0) {
      // Wait for voices to load
      this.synthesis.onvoiceschanged = () => {
        this.voices = this.synthesis!.getVoices();
        this.isReady = this.voices.length > 0;
        console.log('[TTS] Loaded', this.voices.length, 'voices');
      };
    } else {
      this.isReady = true;
      console.log('[TTS] Loaded', this.voices.length, 'voices');
    }
  }

  private selectVoice(): SpeechSynthesisVoice | null {
    if (this.voices.length === 0) return null;

    const characteristics = voiceCharacteristics[this.options.voice];
    
    // Try to find a matching voice
    // Prefer English voices
    const englishVoices = this.voices.filter(v => v.lang.startsWith('en'));
    const voicePool = englishVoices.length > 0 ? englishVoices : this.voices;

    // Sort by matching characteristics
    const scored = voicePool.map(voice => {
      let score = 0;
      const nameLower = voice.name.toLowerCase();
      
      // Gender matching
      if (characteristics.gender === 'female') {
        if (nameLower.includes('female') || nameLower.includes('samantha') || 
            nameLower.includes('victoria') || nameLower.includes('karen') ||
            nameLower.includes('moira') || nameLower.includes('fiona')) {
          score += 10;
        }
      } else {
        if (nameLower.includes('male') || nameLower.includes('daniel') || 
            nameLower.includes('alex') || nameLower.includes('fred')) {
          score += 10;
        }
      }

      // Prefer local voices over remote
      if (!voice.localService) score -= 5;

      return { voice, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.voice || voicePool[0];
  }

  async speak(text: string): Promise<void> {
    if (!this.synthesis || !text.trim()) return;

    // Add to queue if currently speaking
    if (this.isSpeaking) {
      this.audioQueue.push(text);
      return;
    }

    this.isSpeaking = true;
    this.onSpeakingStart?.();

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      // Select voice
      const voice = this.selectVoice();
      if (voice) {
        utterance.voice = voice;
      }

      // Apply options
      utterance.rate = this.options.rate || 1.0;
      utterance.pitch = this.options.pitch || 1.0;
      utterance.volume = this.options.volume || 1.0;

      // Simulate audio levels while speaking
      let levelInterval: NodeJS.Timeout | null = null;
      
      utterance.onstart = () => {
        console.log('[TTS] Speaking started');
        // Simulate varying audio levels
        levelInterval = setInterval(() => {
          const level = 0.3 + Math.random() * 0.4;
          this.onAudioLevel?.(level);
        }, 100);
      };

      utterance.onend = () => {
        console.log('[TTS] Speaking ended');
        if (levelInterval) clearInterval(levelInterval);
        this.onAudioLevel?.(0);
        this.isSpeaking = false;
        this.currentUtterance = null;
        
        // Process next in queue
        if (this.audioQueue.length > 0) {
          const next = this.audioQueue.shift()!;
          this.speak(next).then(resolve).catch(reject);
        } else {
          this.onSpeakingEnd?.();
          resolve();
        }
      };

      utterance.onerror = (event) => {
        console.error('[TTS] Error:', event.error);
        if (levelInterval) clearInterval(levelInterval);
        this.onAudioLevel?.(0);
        this.isSpeaking = false;
        this.currentUtterance = null;
        this.onError?.(event.error);
        reject(new Error(event.error));
      };

      this.synthesis!.speak(utterance);
    });
  }

  stop(): void {
    if (!this.synthesis) return;
    
    this.audioQueue = [];
    this.synthesis.cancel();
    this.isSpeaking = false;
    this.currentUtterance = null;
    this.onAudioLevel?.(0);
  }

  pause(): void {
    this.synthesis?.pause();
  }

  resume(): void {
    this.synthesis?.resume();
  }

  setVoice(voice: OpenAIVoice): void {
    this.options.voice = voice;
  }

  setRate(rate: number): void {
    this.options.rate = Math.max(0.5, Math.min(2.0, rate));
  }

  get speaking(): boolean {
    return this.isSpeaking;
  }

  get ready(): boolean {
    return this.isReady;
  }

  destroy(): void {
    this.stop();
    this.synthesis = null;
    this.voices = [];
  }
}

// Singleton for easy use
let ttsInstance: RealtimeTTSClient | null = null;

export function getTTSClient(voice: OpenAIVoice = 'nova'): RealtimeTTSClient {
  if (!ttsInstance) {
    ttsInstance = new RealtimeTTSClient({ voice });
  } else {
    ttsInstance.setVoice(voice);
  }
  return ttsInstance;
}
