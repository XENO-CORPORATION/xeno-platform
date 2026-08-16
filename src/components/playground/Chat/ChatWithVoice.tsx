import React, { useState, useEffect, useRef } from 'react';
import { IconButton } from '@xenosystem/elements-react';
import { useChatTheme } from './chatTheme';
import { Mic, MicOff, Loader, StopCircle, Play, Pause, AlertTriangle, Copy, Check, MessageSquare, ArrowLeft, Trash, MessageSquareDecl } from '@/lib/icons';
import { GoogleGenAI, Modality } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

// Define necessary interfaces
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  textContent?: string;
  audioUrl?: string;
  timestamp: Date;
  isPlaying?: boolean;
  isGenerating?: boolean;
}

interface SpeechRecognitionEvent extends Event {
  results: any;
  resultIndex: any;
  interpretation: any;
  emma: any;
}

interface SpeechRecognition extends EventTarget {
  grammars: unknown;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  serviceURI: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onaudioend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onerror: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null;
  onsoundstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onsoundend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  addEventListener<K extends keyof SpeechRecognitionEventMap>(type: K, listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof SpeechRecognitionEventMap>(type: K, listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void;
}
interface SpeechRecognitionStatic {
  new (): SpeechRecognition;
}
declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionStatic;
    webkitSpeechRecognition: SpeechRecognitionStatic;
  }
  interface SpeechRecognitionEventMap {
    "audiostart": Event;
    "audioend": Event;
    "end": Event;
    "error": Event;
    "nomatch": SpeechRecognitionEvent;
    "result": SpeechRecognitionEvent;
    "soundstart": Event;
    "soundend": Event;
    "speechstart": Event;
    "speechend": Event;
    "start": Event;
  }
}

type MicrophoneStatus = 'idle' | 'requesting_permission' | 'permission_denied' | 'no_device' | 'initializing' | 'listening' | 'recording' | 'processing_audio';
type AssistantStatus = 'idle' | 'thinking' | 'speaking' | 'error';

const useMicrophoneSetup = (setAvailableMicrophones: React.Dispatch<React.SetStateAction<MediaDeviceInfo[]>>, 
                            setSelectedMicrophoneId: React.Dispatch<React.SetStateAction<string>>) => {
    const populateList = async (promptForPermission = false) => {
        try {
            if (promptForPermission) {
                console.log("useMicrophoneSetup: Prompting for microphone permission for list population."); // ADDED LOG
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop()); 
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
            console.log("useMicrophoneSetup: Found audio input devices:", audioInputDevices); // ADDED LOG
            setAvailableMicrophones(audioInputDevices);

            if (audioInputDevices.length > 0) {
                const storedMicId = localStorage.getItem('selectedMicId');
                const storedMicExists = storedMicId && audioInputDevices.find(d => d.deviceId === storedMicId);

                if (storedMicExists) {
                    console.log("useMicrophoneSetup: Setting microphone to stored ID:", storedMicId); // ADDED LOG
                    setSelectedMicrophoneId(storedMicId);
                } else {
                    // Try to find a preferred device (e.g., one with a label, not default, not communications)
                    let preferredDevice = audioInputDevices.find(d => d.label && d.deviceId !== 'default' && d.deviceId !== 'communications');
                    if (!preferredDevice) { // Fallback: try to find any device with a label
                        preferredDevice = audioInputDevices.find(d => d.label);
                    }
                    if (!preferredDevice) { // Fallback: just use the first device
                        preferredDevice = audioInputDevices[0];
                    }
                    console.log("useMicrophoneSetup: Setting microphone to preferred/default device:", preferredDevice.deviceId); // ADDED LOG
                    setSelectedMicrophoneId(preferredDevice.deviceId); 
                }
            } else {
                console.log("useMicrophoneSetup: No audio input devices found."); // ADDED LOG
                setSelectedMicrophoneId(''); 
            }
        } catch (err) {
            console.error("Error populating microphone list in hook:", err);
            setAvailableMicrophones([]); 
            setSelectedMicrophoneId('');
        }
    };
    return { populateList };
};

const ChatWithVoice: React.FC = () => {
  // Read-only: this surface has no switcher, it wears whatever the chat's slider was left on.
  const { themeClass, themeStyle } = useChatTheme();

  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>('idle');
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus>('idle');
  const [showDetailedChat, setShowDetailedChat] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isSpeechRecognitionSupported, setIsSpeechRecognitionSupported] = useState(true);
  const [liveInterimTranscript, setLiveInterimTranscript] = useState('');
  const [showLiveTranscriptUI, setShowLiveTranscriptUI] = useState(false);
  const [hasMicrophoneDevice, setHasMicrophoneDevice] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [availableMicrophones, setAvailableMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string>('');
  const [currentDisplayMicIndex, setCurrentDisplayMicIndex] = useState(0);
  const [googleApiKey, setGoogleApiKey] = useState<string>('');

  // State for editing and copying messages (from ChatWithLLM)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null); // For user messages
  const [copiedAiMessageId, setCopiedAiMessageId] = useState<string | null>(null); // For AI messages
  const editInputRef = useRef<HTMLTextAreaElement>(null); // For focusing edit textarea

  const [availableVoices, setAvailableVoices] = useState<{ id: string; name: string; lang?: string }[]>([
    { id: 'Puck', name: 'Puck', lang: 'en-US' },
    { id: 'Charon', name: 'Charon', lang: 'en-US' },
    { id: 'Kore', name: 'Kore', lang: 'en-US' },
    { id: 'Fenrir', name: 'Fenrir', lang: 'en-US' },
    { id: 'Aoede', name: 'Aoede', lang: 'en-US' },
    { id: 'Leda', name: 'Leda', lang: 'en-US' },
    { id: 'Orus', name: 'Orus', lang: 'en-US' },
    { id: 'Zephyr', name: 'Zephyr', lang: 'en-US' },
  ]);
  const [currentVoiceIndex, setCurrentVoiceIndex] = useState(0);
  const [initialSettings, setInitialSettings] = useState<{
    micId: string;
    voiceIdx: number;
    providerIdx: number;
    openAiVoiceIdx: number; // Added for OpenAI voice
  } | null>(null);

  // New state for Voice Chat Provider
  const [availableProviders, setAvailableProviders] = useState([
    { id: 'google', name: 'Google' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'elevenlabs', name: 'ElevenLabs' },
  ]);
  const [currentProviderIndex, setCurrentProviderIndex] = useState(0);

  // State for OpenAI specific voices
  const [availableOpenAiVoices, setAvailableOpenAiVoices] = useState<{ id: string; name: string; lang?: string }[]>([
    { id: 'alloy', name: 'Alloy', lang: 'en-US' },
    { id: 'echo', name: 'Echo', lang: 'en-US' },
    { id: 'shimmer', name: 'Shimmer', lang: 'en-US' },
    { id: 'ash', name: 'Ash', lang: 'en-US' },
    { id: 'ballad', name: 'Ballad', lang: 'en-US' }, 
    { id: 'coral', name: 'Coral', lang: 'en-US' },
    { id: 'sage', name: 'Sage', lang: 'en-US' },
    { id: 'verse', name: 'Verse', lang: 'en-US' },
  ]);
  const [currentOpenAiVoiceIndex, setCurrentOpenAiVoiceIndex] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptForCurrentRecordingRef = useRef<string>('');
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);
  const googleAiClientRef = useRef<GoogleGenAI | null>(null);
  const googleLiveSessionRef = useRef<any | null>(null); // Changed LiveSession to any
  const aiAudioChunksRef = useRef<string[]>([]);
  const currentAiSpokenMessageIdRef = useRef<string | null>(null);

  // Refs for OpenAI WebRTC
  const openAiRtcPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const openAiRtcDataChannelRef = useRef<RTCDataChannel | null>(null);
  const openAiSessionIdRef = useRef<string | null>(null); // Added to store session ID
  const openAiSilenceTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Added for manual silence detection

  const { populateList: populateMicrophoneList } = useMicrophoneSetup(
    setAvailableMicrophones,
    setSelectedMicrophoneId,
  );

  useEffect(() => {
    if (showDetailedChat && messageContainerRef.current) {
      messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
    }
  }, [messages, showDetailedChat]);

  useEffect(() => {
    const checkInitialStatus = async () => {
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        setIsSpeechRecognitionSupported(false);
        setLastError("Speech recognition is not supported by your browser. Try Chrome or Edge.");
        setMicrophoneStatus('permission_denied'); 
        return;
      }
      setIsSpeechRecognitionSupported(true);

      try {
        // First, try to check devices without permission (this may not show all devices)
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
        
        // If we find devices with labels, great! If not, we'll assume devices exist but need permission
        if (audioInputDevices.length === 0) {
          console.log("No audio input devices found in initial check (may be due to lack of permission)");
          // Don't set hasMicrophoneDevice to false yet - we'll check again when user tries to record
          setHasMicrophoneDevice(true); // Assume devices exist, will be verified later
          setMicrophoneStatus('idle');
        } else {
          console.log(`Found ${audioInputDevices.length} audio input devices in initial check`);
        setHasMicrophoneDevice(true);
          setMicrophoneStatus('idle');
        }

        // Check permission status
        try {
        const permissionStatusQuery = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (permissionStatusQuery.state === 'granted') {
          setMicrophoneStatus('idle');
          setLastError(null);
            // If permission is already granted, populate the microphone list
            populateMicrophoneList(false);
        } else if (permissionStatusQuery.state === 'prompt') {
          setMicrophoneStatus('idle'); 
          setLastError(null);
        } else { 
            setMicrophoneStatus('idle'); // Changed from 'permission_denied' to 'idle' to allow retry
            setLastError(null); // Don't show error initially, let user try first
        }
          
        permissionStatusQuery.onchange = () => {
            if (permissionStatusQuery.state === 'granted') {
                setMicrophoneStatus('idle');
                setLastError(null);
                populateMicrophoneList(false);
            } else if (permissionStatusQuery.state === 'denied') {
                setMicrophoneStatus('permission_denied');
                setLastError('Microphone access was blocked. Please enable it in your browser settings.');
            }
        };
        } catch (permError) {
          console.warn("Permissions API query failed:", permError);
          // If permissions API fails, just set to idle and let user try
          setMicrophoneStatus('idle');
          setLastError(null);
        }
      } catch (e) {
        console.warn("Error during initial microphone status check:", e);
        // Don't fail completely - assume devices exist and let user try
        setHasMicrophoneDevice(true);
        setMicrophoneStatus('idle');
        setLastError(null);
      }
    };
    
    checkInitialStatus().then(() => {
      // Only populate microphone list if we have permission and detected devices
      if (hasMicrophoneDevice && microphoneStatus === 'idle') {
        // Try to populate list, but don't fail if it doesn't work
        populateMicrophoneList(false).catch(err => {
          console.warn("Failed to populate microphone list in initial setup:", err);
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedMicrophoneId) {
      localStorage.setItem('selectedMicId', selectedMicrophoneId);
    }
  }, [selectedMicrophoneId]);
  
  const handleOpenSettings = () => {
    setInitialSettings({
      micId: selectedMicrophoneId,
      voiceIdx: currentVoiceIndex,
      providerIdx: currentProviderIndex,
      openAiVoiceIdx: currentOpenAiVoiceIndex, // Store current OpenAI voice index
    });
    setShowSettingsModal(true);
    populateMicrophoneList(true);
  };

  const handleSaveSettings = () => {
    localStorage.setItem('selectedVoiceIndex', currentVoiceIndex.toString());
    localStorage.setItem('selectedProviderIndex', currentProviderIndex.toString());
    localStorage.setItem('selectedOpenAiVoiceIndex', currentOpenAiVoiceIndex.toString()); // Save OpenAI voice index

    const selectedProvider = availableProviders[currentProviderIndex]?.id;
    console.log("Selected Voice Chat Provider:", selectedProvider);

    // Only initialize Google client if Google is selected and API key is present
    if (selectedProvider === 'google' && googleApiKey) {
      if (initialSettings?.providerIdx !== currentProviderIndex) {
        console.log("Google provider selected: provider changed. Initializing/Re-initializing Google AI Client.");
        googleAiClientRef.current = new GoogleGenAI({ apiKey: googleApiKey });
      } else {
        console.log("Google provider selected: API Key is the same and client already initialized.");
      }
    } else if (selectedProvider !== 'google') {
      console.log(`Provider ${selectedProvider} selected. Clearing Google AI Client if it exists.`);
      googleAiClientRef.current = null; // Clear Google client if another provider is chosen
    } else if (!googleApiKey && selectedProvider === 'google') {
      console.warn("Google provider selected, but no Google API Key is set. Add your own key (stored in localStorage as 'googleApiKey') to enable Google realtime voice. AI client not initialized.");
      googleAiClientRef.current = null; // Ensure client is null if no key for Google
    }

    setShowSettingsModal(false);
    setInitialSettings(null);
  };

  const handleCancelSettings = () => {
    if (initialSettings) {
      setSelectedMicrophoneId(initialSettings.micId);
      setCurrentVoiceIndex(initialSettings.voiceIdx);
      setCurrentProviderIndex(initialSettings.providerIdx);
      setCurrentOpenAiVoiceIndex(initialSettings.openAiVoiceIdx); // Revert OpenAI voice index
    }
    setShowSettingsModal(false);
    setInitialSettings(null);
  };

  useEffect(() => {
    const savedVoiceIndex = localStorage.getItem('selectedVoiceIndex');
    if (savedVoiceIndex !== null && availableVoices.length > 0) {
      const index = parseInt(savedVoiceIndex, 10);
      if (index >= 0 && index < availableVoices.length) setCurrentVoiceIndex(index);
    }
    // Load saved OpenAI voice index
    const savedOpenAiVoiceIndex = localStorage.getItem('selectedOpenAiVoiceIndex');
    if (savedOpenAiVoiceIndex !== null && availableOpenAiVoices.length > 0) {
      const index = parseInt(savedOpenAiVoiceIndex, 10);
      if (index >= 0 && index < availableOpenAiVoices.length) setCurrentOpenAiVoiceIndex(index);
    }

    // Load saved provider index
    const savedProviderIndex = localStorage.getItem('selectedProviderIndex');
    if (savedProviderIndex !== null && availableProviders.length > 0) {
      const index = parseInt(savedProviderIndex, 10);
      if (index >= 0 && index < availableProviders.length) setCurrentProviderIndex(index);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableVoices, availableProviders, availableOpenAiVoices]); // Added availableProviders and availableOpenAiVoices to dependency array

  useEffect(() => {
    // SECURITY: the platform ships ZERO provider keys. There is no bundled/VITE
    // Google key. Google realtime voice has no secure backend relay in this pass,
    // so the only way it can run is if a user supplies THEIR OWN Google key at
    // runtime via localStorage ('googleApiKey') — a bring-your-own-key path.
    // Otherwise the feature is gated behind "add your key".
    const storedApiKey = localStorage.getItem('googleApiKey');

    if (storedApiKey) {
      console.log("Found user-supplied Google API Key in localStorage (bring-your-own-key).");
      setGoogleApiKey(storedApiKey);
      if (!googleAiClientRef.current) {
        googleAiClientRef.current = new GoogleGenAI({ apiKey: storedApiKey });
      }
    } else {
      console.log("No user-supplied Google API Key. Add your own key to enable Google realtime voice.");
    }
  }, []); // Empty dependency array ensures this runs once on mount

  useEffect(() => {
    if (availableMicrophones.length === 0) {
      setCurrentDisplayMicIndex(0); return;
    }
    if (selectedMicrophoneId) {
      const index = availableMicrophones.findIndex(mic => mic.deviceId === selectedMicrophoneId);
      if (index !== -1) setCurrentDisplayMicIndex(index);
      else {
        setSelectedMicrophoneId(availableMicrophones[0].deviceId);
        setCurrentDisplayMicIndex(0);
      }
    } else {
      setSelectedMicrophoneId(availableMicrophones[0].deviceId);
      setCurrentDisplayMicIndex(0);
    }
  }, [selectedMicrophoneId, availableMicrophones, setSelectedMicrophoneId]);

  const stopRecordingAndCleanup = (reason?: string) => {
    console.log(`Stopping recording and cleaning up. Reason: ${reason || 'N/A'}. Current Mic Status: ${microphoneStatus}`);

    if (googleLiveSessionRef.current) {
      console.log("Closing Google Live API session.");
      try {
        googleLiveSessionRef.current.close();
      } catch (e) {
        console.error("Error closing Google Live API session:", e);
      }
      googleLiveSessionRef.current = null;
    }

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
        console.log("SpeechRecognition stopped.");
      } catch (e) {
        console.warn("Error stopping speech recognition (might have already stopped or never started):", e);
      }
      speechRecognitionRef.current.onstart = null;
      speechRecognitionRef.current.onresult = null;
      speechRecognitionRef.current.onerror = null;
      speechRecognitionRef.current.onend = null;
      speechRecognitionRef.current.onspeechstart = null;
      speechRecognitionRef.current.onspeechend = null;
      speechRecognitionRef.current = null;
    }

    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused') {
        try {
          mediaRecorderRef.current.stop();
          console.log("MediaRecorder stop() called.");
        } catch (e) {
          console.warn("Error calling MediaRecorder.stop():", e);
           if (currentStreamRef.current) {
                console.warn("MediaRecorder.stop() failed, forcefully stopping stream tracks.");
                currentStreamRef.current.getTracks().forEach(track => track.stop());
                currentStreamRef.current = null;
            }
        }
      }
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.onerror = null;
      mediaRecorderRef.current = null;
    } else {
        if (currentStreamRef.current) {
            console.log("MediaRecorder was null, ensuring stream tracks are stopped.");
            currentStreamRef.current.getTracks().forEach(track => track.stop());
            currentStreamRef.current = null;
        }
    }
    
    if (currentStreamRef.current) {
        console.log("Stopping all tracks on currentStreamRef.");
        currentStreamRef.current.getTracks().forEach(track => track.stop());
        currentStreamRef.current = null;
    }

    setShowLiveTranscriptUI(false);
    setLiveInterimTranscript('');
    finalTranscriptForCurrentRecordingRef.current = '';
        audioChunksRef.current = [];
        
    // OpenAI WebRTC Cleanup
    if (openAiRtcDataChannelRef.current) {
      try {
        openAiRtcDataChannelRef.current.close();
        console.log("OpenAI RTCDataChannel closed.");
      } catch (e) {
        console.error("Error closing OpenAI RTCDataChannel:", e);
      }
      openAiRtcDataChannelRef.current = null;
    }
    
    // Clear OpenAI silence timeout
    if (openAiSilenceTimeoutRef.current) {
      clearTimeout(openAiSilenceTimeoutRef.current);
      openAiSilenceTimeoutRef.current = null;
    }
    if (openAiRtcPeerConnectionRef.current) {
      try {
        // Remove all event listeners before closing
        openAiRtcPeerConnectionRef.current.onicecandidate = null;
        openAiRtcPeerConnectionRef.current.ontrack = null;
        openAiRtcPeerConnectionRef.current.ondatachannel = null;
        openAiRtcPeerConnectionRef.current.onconnectionstatechange = null;
        openAiRtcPeerConnectionRef.current.onicegatheringstatechange = null;
        openAiRtcPeerConnectionRef.current.onsignalingstatechange = null;
        
        // Remove tracks
        openAiRtcPeerConnectionRef.current.getSenders().forEach(sender => {
          if (sender.track) {
            sender.track.stop();
          }
          // Don't check if(openAiRtcPeerConnectionRef.current) here as it leads to a TS error
          // about openAiRtcPeerConnectionRef.current possibly being null even though it is checked above.
          // It is safer to just call removeTrack if sender exists.
          try {
            openAiRtcPeerConnectionRef.current?.removeTrack(sender);
          } catch (e) {
            console.warn("Error removing track during cleanup:", e);
          }
        });

        openAiRtcPeerConnectionRef.current.close();
        console.log("OpenAI RTCPeerConnection closed.");
      } catch (e) {
        console.error("Error closing OpenAI RTCPeerConnection:", e);
      }
      openAiRtcPeerConnectionRef.current = null;
    }
    openAiSessionIdRef.current = null; // Clear session ID
        
    if (microphoneStatus !== 'permission_denied' && microphoneStatus !== 'no_device' && microphoneStatus !== 'processing_audio') {
      setMicrophoneStatus('idle');
    }
    console.log("Cleanup complete. Mic Status should be idle or processing.");
  };

  const handleMediaRecorderOnStop = async () => {
    console.log('MediaRecorder.onstop triggered. Current Mic Status:', microphoneStatus);
    
    // For Google Live API, the transcription and user message creation 
    // is handled by the Google Live API callbacks (inputTranscription.isFinal)
    // So we don't need to process finalTranscriptForCurrentRecordingRef here
    
    const transcriptToUse = finalTranscriptForCurrentRecordingRef.current.trim();
    
    if (transcriptToUse) {
      console.log("Final transcript available from Google Live API:", transcriptToUse);
      // The transcript should have already been added to messages by the Google Live API callback
      // but if for some reason it wasn't, we can add it here as a fallback
      const existingUserMessage = messages.find(msg => 
        msg.role === 'user' && 
        msg.textContent === transcriptToUse &&
        Math.abs(msg.timestamp.getTime() - Date.now()) < 10000 // Within last 10 seconds
      );
      
      if (!existingUserMessage) {
        console.log("Adding fallback user message from transcript");
        const userMessageId = `user-fallback-${Date.now()}`;
        const userMessage: ChatMessage = {
          id: userMessageId,
          role: 'user',
          textContent: transcriptToUse,
          timestamp: new Date(),
          isPlaying: false,
          isGenerating: false
        };
        setMessages(prev => [...prev, userMessage]);
      }
    } else {
      console.log("MediaRecorder.onstop: No final transcript available.");
      // This is normal for Google Live API as transcripts are handled in real-time
    }

    // Clear the final transcript ref for the next recording session
    finalTranscriptForCurrentRecordingRef.current = ''; 
    audioChunksRef.current = []; // Ensure audio chunks are cleared

    console.log("MediaRecorder.onstop processing complete.");
  };

  const processAndSendAudioChunk = async (audioBlob: Blob) => {
    if (!googleLiveSessionRef.current || !googleLiveSessionRef.current.sendRealtimeInput) {
      console.warn("Google Live session not active or sendRealtimeInput not available, skipping audio chunk.");
      return;
    }
    
    console.log("Processing audio chunk for Google Live API. Blob size:", audioBlob.size, "type:", audioBlob.type);

    try {
      // Convert audio blob to ArrayBuffer
      const audioBuffer = await audioBlob.arrayBuffer();
      
      if (audioBuffer.byteLength === 0) {
        console.warn("Empty audio buffer, skipping...");
        return;
      }

      // Create AudioContext for audio processing
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      try {
        // Decode the audio data (WebM/Opus from MediaRecorder)
        const decodedAudioBuffer = await audioContext.decodeAudioData(audioBuffer);
        
        // Google Live API expects 16kHz mono PCM
        const targetSampleRate = 16000;
        const numberOfChannels = 1;
        
        // Calculate duration and create offline context for resampling
        const duration = decodedAudioBuffer.duration;
        const frameCount = Math.round(duration * targetSampleRate);
        
        const offlineContext = new OfflineAudioContext(
          numberOfChannels,
          frameCount,
          targetSampleRate
        );

        // Create buffer source and connect for resampling
        const bufferSource = offlineContext.createBufferSource();
        bufferSource.buffer = decodedAudioBuffer;
        bufferSource.connect(offlineContext.destination);
        bufferSource.start();

        // Render the resampled audio
        const resampledAudioBuffer = await offlineContext.startRendering();
        console.log(`Audio resampled: ${resampledAudioBuffer.length} samples at ${resampledAudioBuffer.sampleRate}Hz`);

        // Convert to 16-bit PCM
        const pcmFloat32Data = resampledAudioBuffer.getChannelData(0);
        const pcm16BitData = new Int16Array(pcmFloat32Data.length);

        // Convert Float32 samples to Int16
        for (let i = 0; i < pcmFloat32Data.length; i++) {
          const sample = Math.max(-1, Math.min(1, pcmFloat32Data[i]));
          pcm16BitData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        // Convert Int16Array to base64 string
        const bytes = new Uint8Array(pcm16BitData.buffer);
        let binary = '';
        const chunkSize = 0x8000; // 32KB chunks to avoid call stack issues
        
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        
        const base64Audio = btoa(binary);
        console.log(`Converted to base64 PCM, length: ${base64Audio.length}`);

        // Send to Google Live API
        await googleLiveSessionRef.current.sendRealtimeInput({
          audio: {
            data: base64Audio,
            mimeType: "audio/pcm;rate=16000"
          }
        });
        
        console.log("Successfully sent audio chunk to Google Live API");

      } catch (decodeError) {
        console.error("Audio decoding error:", decodeError);
        // Don't throw error for individual chunk failures, just log and continue
      } finally {
        // Clean up audio context
        try {
          await audioContext.close();
        } catch (closeError) {
          console.warn("Error closing audio context:", closeError);
        }
      }

    } catch (error) {
      console.error("Error processing audio chunk for Google Live API:", error);
      // Only set error and stop if we have repeated failures
      // For now, just log and continue to avoid stopping the session for single chunk failures
    }
  };

  const setupAndStartMediaServices = async () => {
    console.log("Attempting to setup and start media services...");
    setMicrophoneStatus('initializing');
    setLastError(null);

    if (!isSpeechRecognitionSupported) {
      setLastError("Your browser doesn't support speech recognition. Try Chrome or Edge.");
      setMicrophoneStatus('permission_denied'); 
      return;
    }
    if (!hasMicrophoneDevice) {
        setLastError("No microphone detected. Please connect one.");
        setMicrophoneStatus('no_device');
        return;
    }

    if (mediaRecorderRef.current || speechRecognitionRef.current || currentStreamRef.current) {
        console.warn("Found existing media refs during setup. Forcing cleanup.");
        stopRecordingAndCleanup("Pre-emptive cleanup before new start");
    }
    
    let stream: MediaStream;
    try {
      const audioConstraintsConfig = selectedMicrophoneId 
        ? { audio: { deviceId: { exact: selectedMicrophoneId } } } 
        : { audio: true };
      stream = await navigator.mediaDevices.getUserMedia(audioConstraintsConfig);
      currentStreamRef.current = stream;
      console.log("getUserMedia successful, stream obtained.");

      if (!stream.getAudioTracks().some(track => track.enabled && track.readyState === 'live')) {
        console.error('getUserMedia returned a stream with no active/live audio tracks.');
        setLastError('Failed to get a usable audio stream. Try another mic or check system settings.');
        stopRecordingAndCleanup("No live audio tracks in stream");
        return;
      }
    } catch (err: any) {
      console.error('Error getting media stream (getUserMedia):', err);
      let detailedError = 'Failed to access microphone.';
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        detailedError = selectedMicrophoneId ? 'Selected microphone not found.' : 'No microphone found.';
        setMicrophoneStatus('no_device');
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        detailedError = 'Microphone access denied.';
        setMicrophoneStatus('permission_denied');
      } else if (err.name === 'OverconstrainedError') {
        detailedError = 'Selected microphone is not available or cannot satisfy constraints.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        detailedError = 'Microphone is in use or cannot be accessed.';
        setMicrophoneStatus('no_device');
      }
      setLastError(detailedError);
      stopRecordingAndCleanup(`getUserMedia error: ${err.name}`);
      return;
    }

    try {
      if (!currentStreamRef.current) {
        console.error("Stream is null before MediaRecorder init. Aborting.");
        setLastError("Internal error: Media stream lost before recording setup.");
        stopRecordingAndCleanup("Stream lost pre-MediaRecorder");
        return;
      }
      mediaRecorderRef.current = new MediaRecorder(currentStreamRef.current, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        console.log("MediaRecorder.ondataavailable - event received. Data size:", event.data.size);
        if (event.data.size > 0) {
          processAndSendAudioChunk(event.data);
        } else {
          console.log("MediaRecorder.ondataavailable - event data size is 0.");
        }
      };
      mediaRecorderRef.current.onstop = handleMediaRecorderOnStop;

      mediaRecorderRef.current.onerror = (event: any) => {
        console.error('MediaRecorder error:', event);
        setLastError(`MediaRecorder error: ${event.error?.message || 'Unknown error'}`);
        stopRecordingAndCleanup("MediaRecorder onerror");
      };
      console.log("MediaRecorder initialized.");
    } catch (err) {
      console.error("Error initializing MediaRecorder:", err);
      setLastError("Failed to initialize audio recorder.");
      stopRecordingAndCleanup("MediaRecorder initialization failed");
      return;
    }

    // Start MediaRecorder and connect to Google Live API
    try {
      if (!mediaRecorderRef.current) {
        console.error("MediaRecorder is null before starting. Aborting.");
        setLastError("Internal error: Recorder lost before start.");
        stopRecordingAndCleanup("MediaRecorder null before start");
        return;
      }
      
      if (mediaRecorderRef.current.state !== 'inactive') {
          console.error(`MediaRecorder in unexpected state (${mediaRecorderRef.current.state}) before start. Aborting.`);
          setLastError("Recorder was not ready. Please try again.");
          stopRecordingAndCleanup("MediaRecorder not inactive pre-start");
          return;
      }
      
      // Start recording with a shorter timeslice for more frequent audio chunks
      mediaRecorderRef.current.start(100); // 100ms chunks for more real-time processing
      console.log("MediaRecorder.start() called. State:", mediaRecorderRef.current.state);

      // Connect to Google Live API
      await initiateGoogleLiveApiSession();

    } catch (err: any) {
      console.error('Error starting media services:', err);
      setLastError(`Failed to start recording: ${err.message || 'Unknown error'}`);
      stopRecordingAndCleanup(`Error during start calls: ${err.name}`);
    }
  };

  const initiateGoogleLiveApiSession = async () => {
    if (!googleApiKey || !googleAiClientRef.current) {
      setLastError("Google API Key not set. Please configure it in settings.");
      console.error("Google API Key or AI Client not available for Live API connection.");
      stopRecordingAndCleanup("Google API key/client missing");
      return;
    }

    console.log("Initiating Google Live API session...");
    const modelName = 'gemini-2.5-flash-preview-native-audio-dialog';
    const selectedVoice = availableVoices[currentVoiceIndex]?.id;
    
    const config = {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {
        enabled: true,
        model: 'whisper-1' // Use Google's STT
      },
      outputAudioTranscription: {
        enabled: true
      },
      systemInstruction: {
        parts: [{ 
          text: "You are a helpful and friendly voice assistant. Keep your responses concise and conversational. Speak naturally as if you're having a real conversation with the user. Be engaging but not overly verbose."
        }]
      },
      speechConfig: selectedVoice ? {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: selectedVoice }
        }
      } : undefined,
    };

    try {
      const session = await googleAiClientRef.current.live.connect({
        model: modelName,
        config: config,
        callbacks: {
          onopen: () => {
            console.log('Google Live API session opened successfully.');
            setMicrophoneStatus('listening'); 
            setShowLiveTranscriptUI(true);
            setLastError(null); 
            
            // Set initial timeout for when no speech is detected
            if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = setTimeout(() => {
              console.log('Initial silence timeout (30s). Stopping Google Live API session.');
              stopRecordingAndCleanup("Initial silence timeout (Google Live API)");
            }, 30000); // 30 seconds initial timeout
          },
          
          onmessage: (message: any) => {
            console.debug('Google Live API message received:', message.type || 'unknown');
            
            // Handle usage metadata
            if (message.usage_metadata) {
              console.log("Google Live API Usage:", message.usage_metadata);
            }
            
            // Handle session warnings
            if (message.go_away) {
              console.warn("Google Live API session ending:", message.go_away);
              setLastError("Session is ending. Please start a new conversation.");
            }

            // Handle server content
            if (message.serverContent) {
              if (message.serverContent.interrupted === true) {
                console.log("Google Live API: Model generation was interrupted.");
                setAssistantStatus('idle');
              }
              
              if (message.serverContent.generationComplete === true) {
                console.log("Google Live API: Model generation complete for this turn.");
              }

              // Handle input transcription (user speech-to-text)
              if (message.serverContent.inputTranscription) {
                const transcript = message.serverContent.inputTranscription.text || '';
                const isFinal = message.serverContent.inputTranscription.isFinal || false;
                
                console.log(`Google STT ${isFinal ? '(final)' : '(interim)'}:`, transcript);
                
                if (isFinal) {
                  // Final transcript - add to messages and clear live display
                  if (transcript.trim()) {
                    finalTranscriptForCurrentRecordingRef.current = transcript.trim();
                    setLiveInterimTranscript('');
                    
                    const userMessage: ChatMessage = {
                      id: `user-${Date.now()}`,
                      role: 'user',
                      textContent: transcript.trim(),
                      timestamp: new Date(),
                      isPlaying: false,
                      isGenerating: false
                    };
                    setMessages(prev => [...prev, userMessage]);
                  }
                } else {
                  // Interim transcript - show live
                  setLiveInterimTranscript(transcript);
                }

                // Reset silence timer on any transcript activity
                if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
                silenceTimeoutRef.current = setTimeout(() => {
                  console.log('Silence timeout after user speech. Stopping session.');
                  stopRecordingAndCleanup("Silence after user speech (Google Live API)");
                }, 15000); // 15 seconds after speech
              }

              // Handle AI output transcription
              let aiTranscriptForMessage = '';
              if (message.serverContent.outputTranscription?.text) {
                aiTranscriptForMessage = message.serverContent.outputTranscription.text;
                console.log("Google AI transcript:", aiTranscriptForMessage);
              }

              // Handle AI audio response
              if (message.serverContent.modelTurn?.parts?.[0]?.data) {
                const audioDataB64 = message.serverContent.modelTurn.parts[0].data;
                console.log("Received AI audio data chunk (base64 length):", audioDataB64.length);
                aiAudioChunksRef.current.push(audioDataB64);
                setAssistantStatus('speaking');

                // Create or update AI message
                if (!currentAiSpokenMessageIdRef.current) {
                  currentAiSpokenMessageIdRef.current = `assistant-${Date.now()}`;
                  const aiMessage: ChatMessage = {
                    id: currentAiSpokenMessageIdRef.current,
                    role: 'assistant',
                    textContent: aiTranscriptForMessage || "🔊 Speaking...",
                    timestamp: new Date(),
                    isGenerating: true,
                    isPlaying: false
                  };
                  setMessages(prev => [...prev, aiMessage]);
                } else if (aiTranscriptForMessage) {
                  // Update existing message with transcript
                  setMessages(prev => prev.map(msg => 
                    msg.id === currentAiSpokenMessageIdRef.current 
                    ? { ...msg, textContent: aiTranscriptForMessage, isGenerating: true } 
                    : msg
                  ));
                }
              }

              // Handle turn completion
              if (message.serverContent.turnComplete) {
                console.log("Google Live API: Turn complete.");
                if (aiAudioChunksRef.current.length > 0 && currentAiSpokenMessageIdRef.current) {
                  const finalTranscript = aiTranscriptForMessage || "Audio response";
                  playConcatenatedAiAudio(currentAiSpokenMessageIdRef.current, finalTranscript);
                } else {
                  // Turn complete but no audio - finalize any pending message
                  if (currentAiSpokenMessageIdRef.current) {
                    setMessages(prev => prev.map(msg => 
                      msg.id === currentAiSpokenMessageIdRef.current 
                      ? { ...msg, textContent: aiTranscriptForMessage || msg.textContent, isGenerating: false } 
                      : msg
                    ));
                  }
                  setAssistantStatus('idle');
                  currentAiSpokenMessageIdRef.current = null;
                }
              }
            }
          },
          
          onerror: (error: any) => {
            console.error('Google Live API error:', error);
            setLastError(`Google AI Error: ${error.message || 'Connection failed'}`);
            setAssistantStatus('error');
            stopRecordingAndCleanup("Google Live API error");
          },
          
          onclose: (event?: any) => {
            console.log('Google Live API session closed.', event?.reason || 'No reason provided');
            // Only trigger cleanup if session wasn't intentionally closed by us
            if (googleLiveSessionRef.current) {
              stopRecordingAndCleanup("Google Live API session closed unexpectedly");
            }
          },
        },
      });

      googleLiveSessionRef.current = session;
      console.log("Google Live API session established successfully.");

    } catch (error: any) {
      console.error("Failed to connect to Google Live API:", error);
      setLastError(`Failed to connect to Google AI: ${error.message || 'Unknown error'}`);
      setAssistantStatus('error');
      stopRecordingAndCleanup("Google Live API connection failed");
    }
  };

  const playConcatenatedAiAudio = async (messageId: string, fallbackTextContent: string) => {
    if (aiAudioChunksRef.current.length === 0) {
      console.warn("playConcatenatedAiAudio called with no audio chunks.");
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, isPlaying: false, isGenerating: false, textContent: fallbackTextContent } : msg
      ));
      setAssistantStatus('idle');
      currentAiSpokenMessageIdRef.current = null;
      return;
    }

    const combinedBase64 = aiAudioChunksRef.current.join('');
    aiAudioChunksRef.current = []; // Clear for next response

    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(combinedBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcmArrayBuffer = bytes.buffer;

      // Google AI Live API output is 24kHz, 16-bit PCM, mono (usually)
      const sampleRate = 24000; 
      const numberOfChannels = 1;
      const totalSamples = pcmArrayBuffer.byteLength / 2; // 16-bit = 2 bytes per sample

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = audioCtx.createBuffer(numberOfChannels, totalSamples, sampleRate);
      
      // Fill the AudioBuffer with the PCM data
      const pcm16Data = new Int16Array(pcmArrayBuffer);
      const float32ChannelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < totalSamples; i++) {
        float32ChannelData[i] = pcm16Data[i] / 32768.0; // Convert Int16 to Float32 range [-1.0, 1.0]
      }

      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause(); // Stop any previous playback
      }
      
      // Play the buffer
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      source.onended = () => {
        console.log("AI audio playback ended.");
        setAssistantStatus('idle');
        setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, isPlaying: false, isGenerating: false } : msg));
        currentAiSpokenMessageIdRef.current = null;
        audioCtx.close();
      };
      source.start();
      setAssistantStatus('speaking');
      setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, isPlaying: true, isGenerating: false, textContent: fallbackTextContent } : msg));

    } catch (error) {
      console.error("Error playing concatenated AI audio:", error);
      setLastError("Could not play AI audio response.");
      setAssistantStatus('error');
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, isPlaying: false, isGenerating: false, textContent: fallbackTextContent } : msg
      ));
      currentAiSpokenMessageIdRef.current = null;
      aiAudioChunksRef.current = []; // Clear chunks on error too
    }
  };

  const initiateRecordingSequence = async () => {
    console.log("Initiating recording sequence...");
    setMicrophoneStatus('requesting_permission');
    setLastError(null);

    const selectedProvider = availableProviders[currentProviderIndex]?.id;
    console.log(`Initiating recording sequence for provider: ${selectedProvider}`);

    if (selectedProvider === 'google') {
      // Ensure Google AI Client is ready before proceeding (for Google provider)
      if (!googleAiClientRef.current && googleApiKey) {
        console.log("Google AI Client not ready in initiateRecordingSequence, attempting to initialize.");
        try {
          googleAiClientRef.current = new GoogleGenAI({ apiKey: googleApiKey });
          console.log("Google AI Client initialized successfully in initiateRecordingSequence.");
        } catch (e: any) {
          console.error("Failed to initialize Google AI Client in initiateRecordingSequence:", e);
          setLastError("Failed to initialize AI services. Check API Key. " + e.message);
          setMicrophoneStatus('idle');
          return;
        }
      } else if (!googleApiKey) {
        setLastError("Google realtime voice needs your own Google API key. Add your key (stored as 'googleApiKey') to enable it — the platform ships no bundled key, and a secure backend relay is not available yet.");
        setMicrophoneStatus('idle');
        return;
      } else if (!googleAiClientRef.current) {
          setLastError("Google AI client could not be initialized. Please check settings or refresh.");
          setMicrophoneStatus('idle');
          return;
      }
    } else if (selectedProvider === 'openai') {
      // Placeholder for OpenAI specific checks if any (e.g. an OpenAI API key if not using ephemeral for some direct client calls - but we are for WebRTC)
      console.log("OpenAI provider selected. Ephemeral key will be fetched.");
    } else if (selectedProvider === 'elevenlabs') {
      setLastError("ElevenLabs provider is not yet implemented.");
      setMicrophoneStatus('idle');
      return;
    } else {
      setLastError(`Unknown provider selected: ${selectedProvider}. Please select a valid provider.`);
      setMicrophoneStatus('idle');
      return;
    }

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setIsSpeechRecognitionSupported(false);
      setLastError("Speech recognition is not supported by your browser.");
      setMicrophoneStatus('permission_denied');
      return;
    }
    setIsSpeechRecognitionSupported(true);

    // Check for microphones - be more permissive for OpenAI provider
    try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
    if (audioInputDevices.length === 0) {
        // For OpenAI provider, we'll let the WebRTC setup handle device detection
        // since getUserMedia will give us a more accurate result
        if (selectedProvider === 'openai') {
          console.log("No devices found in initial check for OpenAI provider, but proceeding to WebRTC setup for real device detection");
          setHasMicrophoneDevice(true); // Assume devices exist, WebRTC setup will verify
        } else {
      setHasMicrophoneDevice(false);
      setLastError("No microphone detected. Please connect one.");
      setMicrophoneStatus('no_device');
      return;
    }
      } else {
        console.log(`Found ${audioInputDevices.length} audio input devices for ${selectedProvider} provider`);
    setHasMicrophoneDevice(true);
      }
    } catch (deviceError) {
      console.warn("Error checking devices in initiateRecordingSequence:", deviceError);
      // For OpenAI, be permissive and let WebRTC setup handle it
      if (selectedProvider === 'openai') {
        console.log("Device enumeration failed for OpenAI provider, but proceeding to WebRTC setup");
        setHasMicrophoneDevice(true);
      } else {
        setHasMicrophoneDevice(false);
        setLastError("Could not check for microphones. Please ensure your browser supports microphone access.");
        setMicrophoneStatus('no_device');
        return;
      }
    }

    if (availableMicrophones.length === 0) {
        await populateMicrophoneList(false);
    }

    let permissionGranted = false;
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (permissionStatus.state === 'granted') {
        permissionGranted = true;
      } else if (permissionStatus.state === 'prompt') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
          permissionGranted = true;
          await populateMicrophoneList(false);
        } catch (err) {
          console.error('Microphone permission denied during explicit request:', err);
          setLastError('Microphone permission denied. Please enable it in settings.');
          setMicrophoneStatus('permission_denied');
          return;
        }
      } else {
        setLastError('Microphone access is blocked. Please enable it in settings.');
        setMicrophoneStatus('permission_denied');
        return;
      }
    } catch (e) {
      console.warn("Permissions API query failed, attempting direct getUserMedia for permission.", e);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        permissionGranted = true;
        await populateMicrophoneList(false);
      } catch (err_gum) {
        setLastError('Microphone permission is required. Please enable it.');
        setMicrophoneStatus('permission_denied');
        return;
      }
    }

    if (!permissionGranted) {
        setLastError('Could not obtain microphone permission.');
        setMicrophoneStatus('permission_denied');
        return;
    }
    
    setLastError(null);
    // await setupAndStartMediaServices(); // This will be called conditionally
    if (selectedProvider === 'google') {
      await setupAndStartMediaServices(); // Existing Google setup
    } else if (selectedProvider === 'openai') {
      await initiateOpenAiWebRTCSession();
    } else {
      // Handle other providers or show error if not implemented
      console.warn(`Provider ${selectedProvider} selected, but no media service handler implemented yet.`);
      setMicrophoneStatus('idle');
    }
  };

  const initiateOpenAiWebRTCSession = async () => {
    console.log('OpenAI: Initiating OpenAI WebRTC Session...');
    
    try {
      setMicrophoneStatus('requesting_permission');
      
      // Request microphone access
      console.log('OpenAI: Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          deviceId: selectedMicrophoneId ? { exact: selectedMicrophoneId } : undefined,
          sampleRate: 24000, // OpenAI Realtime API expects 24kHz
          channelCount: 1,    // Mono audio
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      if (!stream) {
        throw new Error('Failed to get microphone stream');
      }
      
      console.log('OpenAI: getUserMedia successful, stream obtained.');
      const audioTrack = stream.getAudioTracks()[0];
      currentStreamRef.current = stream;
      
      if (!audioTrack) {
        throw new Error('No audio track found in stream');
      }
      
      // Create RTCPeerConnection
      console.log('OpenAI: Creating RTCPeerConnection...');
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      openAiRtcPeerConnectionRef.current = pc;
      
      // Add audio track to peer connection
      console.log('OpenAI: Adding local audio track to RTCPeerConnection:', audioTrack.label);
      pc.addTrack(audioTrack, stream);
      
      // Create audio element for remote audio playback
      if (!audioPlayerRef.current) {
        audioPlayerRef.current = new Audio();
        audioPlayerRef.current.autoplay = true;
        audioPlayerRef.current.controls = false;
      }
      
      // Handle remote audio
      pc.ontrack = (event) => {
        console.log('OpenAI: Received remote audio track');
        if (audioPlayerRef.current && event.streams[0]) {
          audioPlayerRef.current.srcObject = event.streams[0];
          audioPlayerRef.current.play().catch(err => {
            console.error('OpenAI: Error playing remote audio:', err);
          });
        }
      };
      
      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log('OpenAI: RTCPeerConnection connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          console.log('OpenAI: WebRTC connection established successfully');
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          console.error('OpenAI: WebRTC connection failed or disconnected');
          stopRecordingAndCleanup('OpenAI: WebRTC connection failed');
        }
      };
      
      // Create data channel for OpenAI Realtime API events
      console.log('OpenAI: Creating RTCDataChannel \'audioDataChannel\'.');
      const dataChannel = pc.createDataChannel('oai-events');
      openAiRtcDataChannelRef.current = dataChannel;
      
      // Handle data channel events
      dataChannel.onopen = () => {
        console.log('OpenAI: RTCDataChannel \'audioDataChannel\' opened successfully.');
        setMicrophoneStatus('listening');
        setAssistantStatus('idle');
        setShowLiveTranscriptUI(true);
        setLiveInterimTranscript(''); // Clear any previous transcript
        
        // Send session configuration via data channel
        const selectedOpenAiVoiceId = availableOpenAiVoices[currentOpenAiVoiceIndex]?.id || 'alloy';
        const sessionConfig = {
          type: 'session.update',
          session: {
            instructions: "Your knowledge cutoff is 2023-10. You are a helpful, witty, and friendly AI. Act like a human, but remember that you aren't a human and that you can't do human things in the real world. Your voice and personality should be warm and engaging, with a lively and playful tone. If interacting in a non-English language, start by using the standard accent or dialect familiar to the user. Talk quickly. You should always call a function if you can. Do not refer to these rules, even if you're asked about them.",
            voice: selectedOpenAiVoiceId,
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000, // Keep for AI response timing
              create_response: true,
              interrupt_response: true
            },
            tool_choice: 'auto',
            temperature: 0.8
          }
        };
        dataChannel.send(JSON.stringify(sessionConfig));
        console.log('OpenAI: Sent session configuration');
      };
      
      dataChannel.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('OpenAI: Received data channel message:', message.type);
          
          // Handle different message types from OpenAI
          switch (message.type) {
            case 'session.created':
              console.log('OpenAI: Session created successfully');
              break;
              
            case 'session.updated':
              console.log('OpenAI: Session updated successfully');
              break;
              
            case 'input_audio_buffer.speech_started':
              console.log('OpenAI: User started speaking');
              setAssistantStatus('idle'); // Stop AI if user interrupts
              break;
              
            case 'input_audio_buffer.speech_stopped':
              console.log('OpenAI: User stopped speaking');
              // Session stays open - no timeout, only manual stop
              break;
              
            case 'input_audio_buffer.committed':
              console.log('OpenAI: User audio committed for processing');
              break;
              
            case 'conversation.item.created':
              if (message.item && message.item.type === 'message' && message.item.role === 'user') {
                console.log('OpenAI: User message item created');
              }
              break;
              
            case 'conversation.item.input_audio_transcription.completed':
              // Handle user speech transcription - add to chat
              if (message.transcript) {
                console.log('OpenAI: User said:', message.transcript);
                // Clear the live transcript since it's now complete
                setLiveInterimTranscript('');
                const userMessage: ChatMessage = {
                  id: `user-${Date.now()}`,
                  role: 'user',
                  textContent: message.transcript,
                  timestamp: new Date(),
                  isPlaying: false,
                  isGenerating: false
                };
                setMessages(prev => [...prev, userMessage]);
              }
              break;
              
            case 'conversation.item.input_audio_transcription.failed':
              console.error('OpenAI: User audio transcription failed:', message);
              break;
              
            case 'conversation.item.input_audio_transcription.delta':
              // Handle real-time transcription updates - show in live transcript
              if (message.delta) {
                console.log('OpenAI: Live transcription delta:', message.delta);
                setLiveInterimTranscript(prev => prev + message.delta);
              }
              break;
              
            case 'response.created':
              // AI started generating a response
              console.log('OpenAI: AI response creation started');
              setAssistantStatus('thinking');
              break;
              
            case 'response.output_item.added':
              if (message.item && message.item.type === 'message') {
                console.log('OpenAI: AI message output item added');
                // Create a new assistant message that will be updated with deltas
                const assistantMessage: ChatMessage = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  textContent: '',
                  timestamp: new Date(),
                  isPlaying: false,
                  isGenerating: true
                };
                setMessages(prev => [...prev, assistantMessage]);
              }
              break;
              
            case 'response.content_part.added':
              console.log('OpenAI: AI content part added');
              break;
              
            case 'response.audio_transcript.delta':
              // Handle AI speech transcription deltas - accumulate the response
              if (message.delta) {
                console.log('OpenAI: AI speaking delta:', message.delta);
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMessage = updated[updated.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isGenerating) {
                    lastMessage.textContent = (lastMessage.textContent || '') + message.delta;
                  }
                  return updated;
                });
              }
              break;
              
            case 'response.audio_transcript.done':
              // AI finished speaking transcription
              console.log('OpenAI: AI transcription complete');
              break;
              
            case 'response.audio.delta':
              // AI is sending audio data
              if (message.delta) {
                console.log('OpenAI: Received audio delta, length:', message.delta.length);
                setAssistantStatus('speaking');
              }
              break;
              
            case 'response.audio.done':
              console.log('OpenAI: AI audio complete');
              setAssistantStatus('idle');
              // Mark the assistant message as complete
              setMessages(prev => {
                const updated = [...prev];
                const lastMessage = updated[updated.length - 1];
                if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isGenerating) {
                  lastMessage.isGenerating = false;
                }
                return updated;
              });
              break;
              
            case 'response.done':
              console.log('OpenAI: Response completely done');
              setAssistantStatus('idle');
              setMessages(prev => {
                const updated = [...prev];
                const lastMessage = updated[updated.length - 1];
                if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isGenerating) {
                  lastMessage.isGenerating = false;
                }
                return updated;
              });
              break;
              
            case 'input_audio_buffer.cleared':
              console.log('OpenAI: Input audio buffer cleared');
              break;
              
            case 'error':
              console.error('OpenAI: Error from API:', message);
              setLastError(`OpenAI Error: ${message.error?.message || 'Unknown error'}`);
              break;
              
            default:
              console.log('OpenAI: Unhandled message type:', message.type, message);
          }
        } catch (error) {
          console.error('OpenAI: Error parsing data channel message:', error);
        }
      };
      
      dataChannel.onclose = () => {
        console.log('OpenAI: RTCDataChannel closed.');
        stopRecordingAndCleanup('OpenAI: Data channel closed');
      };
      
      dataChannel.onerror = (error) => {
        console.error('OpenAI: RTCDataChannel error:', error);
        stopRecordingAndCleanup('OpenAI: Data channel error');
      };
      
      // Create SDP offer
      console.log('OpenAI: Creating SDP offer...');
      const offer = await pc.createOffer();
      
      console.log('OpenAI: Setting local description with offer...');
      await pc.setLocalDescription(offer);
      
      // Send SDP offer to OpenAI via our backend
      console.log('OpenAI: Sending SDP offer to OpenAI backend...');
      const response = await fetch('/api/openai-realtime-webrtc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sdpOffer: offer.sdp,
          model: 'gpt-4o-mini-realtime-preview'
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`SDP exchange failed: ${errorData.error || response.statusText}`);
      }
      
      // Get SDP answer from OpenAI
      const sdpAnswer = await response.text();
      console.log('OpenAI: Received SDP answer from backend');
      
      // Set remote description
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: sdpAnswer
      });
      
      console.log('OpenAI: WebRTC session setup complete');
      
    } catch (error) {
      console.error('OpenAI: Error in WebRTC session setup:', error);
      setMicrophoneStatus('idle');
      setAssistantStatus('error');
      setLastError(`OpenAI setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Clean up on error
      if (openAiRtcPeerConnectionRef.current) {
        openAiRtcPeerConnectionRef.current.close();
        openAiRtcPeerConnectionRef.current = null;
      }
      if (openAiRtcDataChannelRef.current) {
        openAiRtcDataChannelRef.current.close();
        openAiRtcDataChannelRef.current = null;
      }
      
      stopRecordingAndCleanup(`OpenAI: WebRTC session setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleMicButtonClick = () => {
    console.log(`Mic button clicked. Mic Status: ${microphoneStatus}, Assistant Status: ${assistantStatus}`);
    if (assistantStatus === 'speaking') {
      stopAssistantAudio();
      return;
    }

    const activeRecordingStates: MicrophoneStatus[] = ['listening', 'recording', 'initializing', 'requesting_permission'];
    if (activeRecordingStates.includes(microphoneStatus)) {
      console.log("Mic button clicked while active, calling stopRecordingAndCleanup.");
      // Check if we're in an OpenAI session and stop it properly
      if (openAiRtcDataChannelRef.current || openAiRtcPeerConnectionRef.current) {
        console.log("Stopping OpenAI WebRTC session via user button click");
        stopRecordingAndCleanup("User clicked stop button during OpenAI session");
      } else {
      stopRecordingAndCleanup("User clicked stop button");
      }
    } else if (microphoneStatus === 'idle' || microphoneStatus === 'permission_denied' || microphoneStatus === 'no_device') {
        console.log("Mic button clicked while idle or in error state, calling initiateRecordingSequence.");
        initiateRecordingSequence();
    } else if (microphoneStatus === 'processing_audio') {
        console.log("Mic button clicked while processing audio. No action.");
    }
  };

  const playAssistantAudio = (messageId: string, audioUrl?: string) => {
    if (!audioUrl) {
        setLastError("No audio available for this message.");
        return;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.src = ""; 
    }
    audioPlayerRef.current = new Audio(audioUrl);
    setAssistantStatus('speaking');
    setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, isPlaying: true } : { ...msg, isPlaying: false }));

    audioPlayerRef.current.play()
      .catch(err => {
        console.error("Error playing audio:", err);
        setLastError("Could not play assistant's response.");
        setAssistantStatus('error');
        setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, isPlaying: false } : msg));
      });

    audioPlayerRef.current.onended = () => {
      setAssistantStatus('idle');
      setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, isPlaying: false } : msg));
    };
    audioPlayerRef.current.onerror = () => {
      console.error("Audio playback error on element");
      setLastError("Error during audio playback.");
      setAssistantStatus('error');
      setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, isPlaying: false } : msg));
    };
  };

  const stopAssistantAudio = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
    }
    setAssistantStatus('idle');
    setMessages(prev => prev.map(msg => ({ ...msg, isPlaying: false })));
  };

  const getMicButtonIcon = () => {
    const iconSize = 32;
    const baseClass = "transition-colors duration-300";

    if (microphoneStatus === 'no_device') return <AlertTriangle size={iconSize} className={`${baseClass} text-[var(--chat-muted)] opacity-70`} />;
    if (microphoneStatus === 'listening' || microphoneStatus === 'recording') return <MicOff size={iconSize} className={`${baseClass} text-[var(--chat-text)]`} />;
    if (microphoneStatus === 'initializing' || microphoneStatus === 'requesting_permission') return <Loader size={iconSize} className={`${baseClass} text-[var(--chat-muted)] animate-spin`} />;
    if (microphoneStatus === 'processing_audio' || assistantStatus === 'thinking') return <Loader size={iconSize} className={`${baseClass} text-[var(--accent-color)] animate-spin`} />;
    if (assistantStatus === 'speaking') return <StopCircle size={iconSize} className={`${baseClass} text-[var(--accent-color)]`} />;
    if (microphoneStatus === 'permission_denied' || assistantStatus === 'error') return <AlertTriangle size={iconSize} className={`${baseClass} text-[var(--chat-muted)] opacity-70`} />;
    return <Mic size={iconSize} className={`${baseClass} text-[var(--chat-text)] opacity-90`} />;
  };

  const getStatusText = () => {
    const selectedProvider = availableProviders[currentProviderIndex]?.name || 'Unknown';
    
    if (lastError) return <span className="text-[var(--chat-text)] font-medium flex items-center text-xs sm:text-sm"><AlertTriangle size={14} className="mr-1.5 text-[var(--chat-muted)] flex-shrink-0" />{lastError}</span>;
    
    let text = `Click the microphone to talk with ${selectedProvider}`;
    if (microphoneStatus === 'no_device') text = "No microphone detected.";
    else if (microphoneStatus === 'listening') text = `Listening with ${selectedProvider}...`; 
    else if (microphoneStatus === 'recording') text = `Listening with ${selectedProvider}...`;
    else if (microphoneStatus === 'processing_audio') text = "Processing your audio...";
    else if (assistantStatus === 'thinking') text = `${selectedProvider} is thinking...`;
    else if (assistantStatus === 'speaking') text = `${selectedProvider} is speaking...`;
    else if (microphoneStatus === 'permission_denied') text = "Microphone permission denied.";
    else if (microphoneStatus === 'requesting_permission') text = "Requesting microphone permission...";
    else if (microphoneStatus === 'initializing') text = `Connecting to ${selectedProvider}...`;
    
    return <span className="text-[var(--chat-muted)] text-xs sm:text-sm">{text}</span>;
  };

  const getMicButtonTitle = (): string => {
    const selectedProvider = availableProviders[currentProviderIndex]?.name || 'Unknown';
    
    if (lastError) return lastError;
    if (microphoneStatus === 'no_device') return "No microphone detected. Click to re-check or check settings.";
    if (microphoneStatus === 'listening' || microphoneStatus === 'recording') {
      // Check if it's an OpenAI session for special handling
      const isOpenAiSession = openAiRtcDataChannelRef.current || openAiRtcPeerConnectionRef.current;
      if (isOpenAiSession) {
        return "OpenAI Voice Chat Active - Click to Stop Session";
      }
      return `Stop ${selectedProvider} Voice Chat`;
    }
    if (microphoneStatus === 'processing_audio') return "Processing your audio...";
    if (assistantStatus === 'thinking') return `${selectedProvider} is thinking...`;
    if (assistantStatus === 'speaking') return `${selectedProvider} is speaking (click to stop)`;
    if (microphoneStatus === 'permission_denied') return "Microphone permission denied. Click to retry or check settings.";
    if (microphoneStatus === 'requesting_permission') return "Requesting microphone permission...";
    if (microphoneStatus === 'initializing') return `Connecting to ${selectedProvider}...`;
    return `Click the microphone to talk with ${selectedProvider}`;
  };

  const micButtonDisabled = 
    microphoneStatus === 'requesting_permission' || 
    microphoneStatus === 'initializing' ||
    (microphoneStatus === 'processing_audio' && assistantStatus === 'thinking');

  const micButtonClasses = () => {
    const selectedProvider = availableProviders[currentProviderIndex]?.id || 'unknown';
    let baseClasses = "rounded-full p-5 sm:p-6 transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--chat-canvas)] shadow-glass hover:shadow-glass-hover backdrop-blur-xs";
    let stateClasses = "bg-[var(--chat-hover)] border border-[var(--chat-border)] hover:border-[var(--chat-muted)] focus:ring-[var(--chat-muted)]";
    
    if (micButtonDisabled) {
      stateClasses = `bg-[var(--chat-control)]/40 border-[var(--chat-border)]/50 text-[var(--chat-muted)] cursor-not-allowed backdrop-blur-none shadow-inner`;
    } else if (microphoneStatus === 'listening' || microphoneStatus === 'recording') {
      // Provider-specific active states
      if (selectedProvider === 'openai') {
        const isOpenAiSession = openAiRtcDataChannelRef.current || openAiRtcPeerConnectionRef.current;
        if (isOpenAiSession) {
          stateClasses = `bg-[var(--chat-control-strong)]/30 border-[var(--chat-border)]/40 hover:border-[var(--chat-muted)]/50 focus:ring-[var(--chat-muted)]/50 openai-listening-pulse`;
        } else {
          stateClasses = `bg-[var(--chat-control-strong)]/30 border-[var(--chat-border)]/40 hover:border-[var(--chat-muted)]/50 focus:ring-[var(--chat-muted)]/50`;
        }
      } else if (selectedProvider === 'google') {
        stateClasses = `bg-[var(--accent-color)]/30 border-[var(--accent-color)]/40 hover:border-[var(--accent-color)]/50 focus:ring-[var(--accent-color)]/50 google-listening-pulse`;
      } else {
        // Default/other providers
        stateClasses = `bg-[var(--accent-color)]/30 border-[var(--accent-color)]/40 hover:border-[var(--accent-color)]/50 focus:ring-[var(--accent-color)]/50`;
      }
    } else if (microphoneStatus === 'processing_audio' || assistantStatus === 'thinking') {
      stateClasses = `bg-[var(--accent-color)]/20 border-[var(--accent-color)]/30 hover:border-[var(--accent-color)]/50 focus:ring-[var(--accent-color)]/50 cursor-wait`;
    } else if (assistantStatus === 'speaking') {
      // Provider-specific speaking states
      if (selectedProvider === 'google') {
        stateClasses = `bg-[var(--accent-color)]/20 border-[var(--accent-color)]/30 hover:border-[var(--accent-color)]/50 focus:ring-[var(--accent-color)]/50`;
      } else if (selectedProvider === 'openai') {
        stateClasses = `bg-[var(--accent-color)]/20 border-[var(--accent-color)]/30 hover:border-[var(--accent-color)]/50 focus:ring-[var(--accent-color)]/50`;
      } else {
        stateClasses = `bg-[var(--accent-color)]/20 border-[var(--accent-color)]/30 hover:border-[var(--accent-color)]/50 focus:ring-[var(--accent-color)]/50`;
      }
    } else if (microphoneStatus === 'permission_denied' || assistantStatus === 'error' || lastError || microphoneStatus === 'no_device') {
      stateClasses = `bg-[var(--chat-control)]/30 border-[var(--chat-border)]/40 hover:border-[var(--chat-muted)]/50 focus:ring-[var(--chat-muted)]/50`;
    }
    
    return `${baseClasses} ${stateClasses}`;
  };

  const renderWaveformVisualizer = () => {
    const barCount = 10;
    let parentDivClass = "flex justify-center items-center h-full w-full waveform-idle";

    if (microphoneStatus === 'listening' || microphoneStatus === 'recording' || assistantStatus === 'speaking') {
      parentDivClass = "flex justify-center items-center h-full w-full waveform-active";
    } else if (microphoneStatus === 'processing_audio' || assistantStatus === 'thinking' || microphoneStatus === 'initializing') {
      parentDivClass = "flex justify-center items-center h-full w-full waveform-processing-active";
    } else if (microphoneStatus === 'permission_denied' || assistantStatus === 'error' || lastError || microphoneStatus === 'no_device') {
      parentDivClass = "flex justify-center items-center h-full w-full waveform-error-active";
    }
  
  return (
      <div className={parentDivClass}>
        {Array.from({ length: barCount }).map((_, i) => (
          <div key={i} className="bar"></div>
        ))}
      </div>
    );
  };
  
  // --- Start: Message Action Handlers (from ChatWithLLM) ---
  const handleEditUserMessage = (messageId: string, currentText?: string) => {
    setEditingMessageId(messageId);
    setEditText(currentText || '');
    setCopiedMessageId(null); // Clear copy confirmation
  };

  const handleCopyUserMessage = (textToCopy?: string, messageId?: string) => {
    if (!textToCopy || !messageId || editingMessageId === messageId) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 1500);
    }).catch(err => console.error('Failed to copy user text: ', err));
  };

  const handleCopyAiMessage = (textToCopy?: string, messageId?: string) => {
    if (!textToCopy || !messageId) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedAiMessageId(messageId);
      setTimeout(() => setCopiedAiMessageId(null), 1500);
    }).catch(err => console.error('Failed to copy AI text: ', err));
  };

  const handleSaveEdit = () => {
    if (!editingMessageId || !editText.trim()) return;
    setMessages(prevMessages =>
      prevMessages.map(msg =>
        msg.id === editingMessageId ? { ...msg, textContent: editText.trim() } : msg
      )
    );
    setEditingMessageId(null);
    setEditText('');
    // Note: No re-submission to AI in voice chat context
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditText('');
  };

  useEffect(() => {
    const textarea = editInputRef.current;
    if (textarea && editingMessageId) {
      textarea.focus();
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [editText, editingMessageId]);
  // --- End: Message Action Handlers ---

  return (
    // Same story as the search interface: this is a sibling route, it never mounts ChatWithLLM, and
    // until the palettes moved to a stylesheet of their own there was nothing here to inherit. The
    // class is the base palette and the style is the exact brightness stop when the slider is not
    // parked on one of the three named ones — apply both, or an eighteen-stop line rounds to three.
    <div
      className={`chat-voice chat-themed xeno-icon-hosts ${themeClass} flex flex-col h-full text-[var(--chat-text)] relative overflow-hidden antialiased`}
      style={themeStyle}
    >
      {!showDetailedChat ? (
        // Main Voice Interface - Show when NOT in chat mode
        <div className="flex flex-col items-center justify-center flex-grow w-full max-w-md mx-auto p-4">
          <div className="w-44 sm:w-48 h-[70px] mb-6 sm:mb-8 flex items-center justify-center relative">
            {renderWaveformVisualizer()}
          </div>
          <button
            onClick={handleMicButtonClick}
            title={getMicButtonTitle()}
            className={micButtonClasses()}
          >
            {getMicButtonIcon()}
          </button>
          <div className="text-center mt-4 mb-6 max-w-sm">
            <p className="text-sm text-[var(--chat-muted)] leading-relaxed">
              {getStatusText()}
            </p>
          </div>

          {/* Voice Interface Controls */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <IconButton
              icon={MessageSquareDecl}
              variant="ghost"
              size="lg"
              iconSize={22}
              onClick={() => setShowDetailedChat(true)}
              title="View Chat History"
            />
          </div>
        </div>
      ) : (
        // Chat Interface - Show when in chat mode with exact ChatWithLLM structure
        <div className="relative flex flex-col h-full text-[var(--chat-text)] overflow-hidden">
          {/* Top Bar */}
          <div className="absolute top-0 left-0 z-10 flex flex-shrink-0 items-center justify-between px-4 pt-4 pb-0 w-full bg-transparent">
            {/* Left side button */}
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowDetailedChat(false)}
                className="flex items-center justify-center bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--chat-text)]/80 hover:border-[var(--chat-muted)] transition-colors h-9"
                aria-label="Go back to voice interface"
                title="Back to Voice"
              >
                <ArrowLeft size={16} />
              </button>
            </div>

            {/* Right side button */}
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setMessages([])}
                className="flex items-center justify-center bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--chat-text)]/80 hover:border-[var(--chat-muted)] transition-colors h-9"
                aria-label="Clear chat history"
                title="Clear Chat"
              >
                <Trash size={16} />
              </button>
            </div>
          </div>

          {/* Chat Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 pb-0 pt-16">
            <div className="max-w-[45rem] mx-auto space-y-4">
              {messages.length === 0 ? (
                <div className="text-center text-[var(--chat-text)]0 py-8">
                  <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No conversation history yet</p>
                  <p className="text-sm mt-2">Start talking to see your messages here</p>
                </div>
              ) : (
                messages
                  .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                  .map((msg, index) => {
                  const isUser = msg.role === 'user';
                  const isLastMessage = index === messages.length - 1;
                  const isLastAiMessage = isLastMessage && !isUser;
                  const firstMessageTopMargin = index === 0 ? 'mt-4' : '';

                  if (msg.isGenerating && !msg.textContent) {
                    return (
                      <div key={msg.id} className="flex justify-start w-full pl-[1.125rem] py-2">
                        <div className="flex items-center gap-2 bg-[var(--chat-control)] border border-[var(--chat-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--chat-muted)]">
                          <span className="flex h-2 w-2 relative mr-1">
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--chat-muted)] animate-pulse"></span> 
                          </span>
                          <span>
                            {assistantStatus === 'thinking' ? "Assistant is thinking..." : "Processing..."}
                          </span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div 
                      key={msg.id} 
                      className={`flex w-full ${isUser ? 'justify-end pr-4' : 'justify-start'} ${firstMessageTopMargin}`}
                    >
                      {isUser ? (
                        editingMessageId === msg.id ? (
                          <div className="flex flex-col bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-2xl rounded-br-none p-3 max-w-[75%] w-full text-[var(--chat-text)]">
                            <textarea
                              ref={editInputRef}
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="w-full bg-transparent text-sm leading-snug text-[var(--chat-text)] outline-none resize-none focus:ring-0 border-none focus:outline-none focus:shadow-none whitespace-pre-wrap"
                              rows={1}
                              style={{ overflowY: 'hidden' }}
                            />
                            <div className="flex items-center justify-end gap-2 mt-1.5 self-end">
                              <button onClick={handleCancelEdit} className="text-sm text-[var(--chat-muted)] hover:text-[var(--chat-text)] px-3 py-1" aria-label="Cancel edit">
                                Cancel
                              </button>
                              <button onClick={handleSaveEdit} className="text-sm bg-[var(--chat-muted)] text-[var(--chat-on-accent)] px-3 py-1 rounded-md font-semibold hover:bg-[var(--chat-hover)] transition-colors" aria-label="Save changes">
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div data-message-id={msg.id} className="group flex flex-col items-end max-w-[75%]">
                            <div className="bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-2xl rounded-br-none p-3 text-[var(--chat-text)]">
                              <p className="text-sm leading-snug whitespace-pre-wrap">{msg.textContent}</p>
                            </div>
                            <div className="flex items-center justify-end gap-2 mt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150">
                              <button onClick={() => handleCopyUserMessage(msg.textContent, msg.id)} className="xeno-icon-hover p-1 text-[var(--chat-muted)] hover:text-[var(--chat-text)] rounded-md" data-selection={copiedMessageId === msg.id ? 'on' : 'off'} aria-label="Copy message">
                                {copiedMessageId === msg.id ? (
                                  <Check size={14} className="text-[var(--chat-text)]" />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </button>
                            </div>
                          </div>
                        )
                      ) : (
                        // AI Message
                        <div data-message-id={msg.id} className="group flex flex-col items-start w-full space-y-2 pr-4">
                          {/* Show pulsating dot when AI is generating response */}
                          {!msg.textContent && !msg.isGenerating && msg.role === 'assistant' && (
                            <div className="flex items-center gap-2 py-2 pl-[1.125rem]">
                              <div className="flex items-center space-x-1 ai-response-dots">
                                <div className="w-2 h-2 rounded-full bg-[var(--chat-muted)] animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 rounded-full bg-[var(--chat-muted)] animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 rounded-full bg-[var(--chat-muted)] animate-bounce" style={{ animationDelay: '300ms' }}></div>
                              </div>
                              <span className="text-[var(--chat-muted)] text-sm">Generating response...</span>
                            </div>
                          )}

                          {/* AI Answer Text */}
                          <div className="w-full pl-[1.125rem]">
                            {msg.textContent && (
                              <div className="prose prose-sm prose-invert max-w-none text-[var(--chat-text)] prose-strong:text-[var(--chat-text)] prose-p:my-1.5 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5"> 
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeRaw]}
                                >
                                  {msg.textContent}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          {msg.textContent && (
                            <div className={`flex items-center gap-2 mt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150`}>
                              <button onClick={() => handleCopyAiMessage(msg.textContent, msg.id)} className="xeno-icon-hover p-1 ml-4 text-[var(--chat-muted)] hover:text-[var(--chat-text)] rounded-md" data-selection={copiedAiMessageId === msg.id ? 'on' : 'off'} aria-label="Copy AI response">
                                {copiedAiMessageId === msg.id ? <Check size={14} className="text-[var(--chat-text)]" /> : <Copy size={14} />}
                              </button>
                              {msg.audioUrl && !msg.isGenerating && (
                                <button
                                  onClick={() => playAssistantAudio(msg.id, msg.audioUrl)} 
                                  disabled={assistantStatus === 'speaking' && !msg.isPlaying} 
                                  title={msg.isPlaying ? "Pause" : "Play assistant response"}
                                  className={`p-1 rounded-md transition-colors 
                                    ${msg.isPlaying 
                                        ? 'text-[var(--accent-color)] hover:text-[var(--accent-color-secondary)]' 
                                        : 'text-[var(--chat-muted)] hover:text-[var(--chat-text)]'
                                    }`}
                                >
                                  {msg.isPlaying ? <Pause size={14} className="block" /> : <Play size={14} className="block" />}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {assistantStatus === 'thinking' && (!messages.length || messages[messages.length-1].role === 'user') && (
                <div className="flex justify-start w-full pl-[1.125rem] py-2">
                  <div className="flex items-center gap-2 bg-[var(--chat-control)] border border-[var(--chat-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--chat-muted)]">
                    <Loader size={16} className="animate-spin mr-1 text-[var(--chat-text)]0" /> 
                    <span>Assistant is thinking...</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Back to Voice Mode Button */}
          <div className="p-4">
            <div className="flex justify-center">
              <button
                onClick={() => setShowDetailedChat(false)}
                className="flex items-center gap-2 px-6 py-3 bg-[var(--chat-hover)] border border-[var(--chat-border)] rounded-xl text-[var(--chat-text)] hover:border-[var(--chat-muted)] transition-all duration-300 shadow-glass hover:shadow-glass-hover backdrop-blur-xs"
                aria-label="Return to voice interface"
                title="Return to voice interface"
              >
                <Mic size={20} />
                <span className="font-medium">Back to Voice Mode</span>
              </button>
            </div>
          </div>
        </div>
      )}



             
    </div>
  );
};

export default ChatWithVoice;

const styleTag = document.getElementById('chat-with-voice-styles') || document.createElement('style');
styleTag.id = 'chat-with-voice-styles';
styleTag.textContent = `
  /* Scoped to this route, and that is the fix rather than tidiness.
   *
   * This block was on :root, injected into <head> at module load, and five of its seven colours were
   * byte-identical duplicates of what index.css already defines there. The other two were not: they
   * replaced the app's accent — a purple — with a violet, everywhere, from the moment anyone opened
   * the voice route. index.css hands that accent to the scrollbars and "interactive elements".
   *
   * So only what is genuinely this route's own survives, and it survives under a class. */
  .chat-voice {
    --accent-color: #5D5FEF; /* Updated accent color to a more vibrant violet/blue */
    --accent-color-secondary: #4B4DDB; /* Slightly darker shade for hover/active states */
    --z-elevated: 10;
  }

  .chat-voice .animate-fadeIn { animation: chat-voice-fade-in 0.2s ease-out forwards; }
  @keyframes chat-voice-fade-in {
    from { opacity: 0; transform: translateY(8px) scale(0.99); }
    to { opacity: 1; transform: translateY(0px) scale(1); }
  }

  .chat-voice .bar {
    background: var(--chat-text); 
    width: 10px; margin: 0px 4px; border-radius: 5px;
    height: 3px; opacity: 0.35;
    transition: height 0.2s ease-out, opacity 0.2s ease-out, background-color 0.2s ease-out;
  }
  @keyframes sound { 0% { opacity: .35; height: 3px; } 100% { opacity: 1; height: 70px; } }
  .chat-voice .waveform-active .bar {
    animation-name: sound; animation-timing-function: linear;
    animation-iteration-count: infinite; animation-direction: alternate;
    animation-play-state: running; background: var(--chat-text);
  }
  .chat-voice .waveform-active .bar:nth-child(1) { animation-duration: 474ms; animation-delay: -500ms; }
  .chat-voice .waveform-active .bar:nth-child(2) { animation-duration: 433ms; animation-delay: -550ms; }
  .chat-voice .waveform-active .bar:nth-child(3) { animation-duration: 407ms; animation-delay: -600ms; }
  .chat-voice .waveform-active .bar:nth-child(4) { animation-duration: 458ms; animation-delay: -450ms; }
  .chat-voice .waveform-active .bar:nth-child(5) { animation-duration: 400ms; animation-delay: -500ms; }
  .chat-voice .waveform-active .bar:nth-child(6) { animation-duration: 427ms; animation-delay: -580ms; }
  .chat-voice .waveform-active .bar:nth-child(7) { animation-duration: 441ms; animation-delay: -520ms; }
  .chat-voice .waveform-active .bar:nth-child(8) { animation-duration: 419ms; animation-delay: -480ms; }
  .chat-voice .waveform-active .bar:nth-child(9) { animation-duration: 487ms; animation-delay: -550ms; }
  .chat-voice .waveform-active .bar:nth-child(10) { animation-duration: 442ms; animation-delay: -600ms; }

  @keyframes sound-processing {
    0%, 100% { height: 5px; opacity: 0.3; background-color: var(--chat-text); } 
    50% { height: 25px; opacity: 0.6; background-color: var(--chat-text); } 
  }
  .chat-voice .waveform-processing-active .bar { animation: sound-processing 1000ms ease-in-out infinite alternate; }
  .chat-voice .waveform-idle .bar { height: 3px; opacity: 0.35; animation: none; }
  .chat-voice .waveform-error-active .bar { height: 5px; opacity: 0.6; background-color: var(--chat-text); animation: none; }

  @keyframes openai-pulse {
    0%, 100% { 
      box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4), 0 0 20px rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.4);
    }
    50% { 
      box-shadow: 0 0 0 8px rgba(255, 255, 255, 0.1), 0 0 30px rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.6);
    }
  }
  .chat-voice .openai-listening-pulse {
    animation: openai-pulse 2s ease-in-out infinite;
  }

  @keyframes google-pulse {
    0%, 100% { 
      box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4), 0 0 20px rgba(59, 130, 246, 0.1);
      border-color: rgba(59, 130, 246, 0.4);
    }
    50% { 
      box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.1), 0 0 30px rgba(59, 130, 246, 0.2);
      border-color: rgba(59, 130, 246, 0.6);
    }
  }
  .chat-voice .google-listening-pulse {
    animation: google-pulse 2s ease-in-out infinite;
  }
`;
if (!document.getElementById('chat-with-voice-styles')) {
  document.head.appendChild(styleTag);
}