import { postXenoRequest } from './xenoProxyRequest';

// Audio model interfaces
export interface AudioModelSettings {
  text?: string;
  prompt?: string;
  // Minimax Speech settings
  voice_setting?: {
    voice_id?: string;
    speed?: number;
    vol?: number;
    pitch?: number;
    emotion?: string;
    english_normalization?: boolean;
    custom_voice_id?: string;
  };
  language_boost?: string;
  output_format?: string;
  audio_setting?: {
    format?: string;
    sample_rate?: number;
    channel?: number;
    bitrate?: number;
  };
  pronunciation_dict?: {
    tone_list?: string[];
  };
  // Orpheus TTS settings
  voice?: string;
  temperature?: number;
  repetition_penalty?: number;
  // ElevenLabs TTS settings
  stability?: number;
  similarity_boost?: number;
  style?: number;
  speed?: number;
  timestamps?: boolean;
  // MMAudio V2 settings
  num_steps?: number;
  cfg_strength?: number;
  mask_away_clip?: boolean;
  negative_prompt?: string;
  // Resemble AI ChatterboxHD Speech-to-Speech settings
  source_audio_url?: string;
  target_voice?: string;
  target_voice_audio_url?: string;
  high_quality_audio?: boolean;
  // Resemble AI ChatterboxHD Text-to-Speech settings
  audio_url?: string;
  exaggeration?: number;
  cfg?: number;
  // General settings
  duration?: number;
  quality?: string;
  seed?: number;
  [key: string]: any; // Allow for model-specific settings
}

export interface GeneratedAudio {
  url: string;
  duration?: number;
  duration_ms?: number;
  file_size?: number;
  content_type?: string;
  seed?: number;
  metadata?: Record<string, any>;
}

export interface AudioGenerationResponse {
  success: boolean;
  error?: string;
  audio: GeneratedAudio | null;
  metadata?: {
    generationTime?: number;
    modelVersion?: string;
    falInput?: Record<string, any>;
    falResult?: any;
    [key: string]: any;
  };
}

interface AudioModelDefinition {
  provider: 'xeno';
  xenoModelId?: string;
  isTextToSpeech?: boolean;
  isMusicGeneration?: boolean;
  isSoundEffects?: boolean;
  isAvailable: boolean;
  unavailableMessage?: string;
  defaultSettings: Partial<AudioModelSettings>;
}

type QueueUpdateCallback = (update: any) => void;

const audioModelRegistry: Record<string, AudioModelDefinition> = {
  'fal-ai/minimax/speech-02-hd': {
    provider: 'xeno',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    isAvailable: false,
    unavailableMessage: 'Minimax Speech is not yet available on Xeno API. Please use an alternative TTS model.',
    defaultSettings: {
      voice_setting: {
        voice_id: 'Wise_Woman',
        speed: 1,
        vol: 1,
        pitch: 0,
        english_normalization: false,
      },
      language_boost: 'auto',
      output_format: 'url',
      audio_setting: {
        format: 'mp3',
        sample_rate: 32000,
        channel: 1,
        bitrate: 128000,
      },
    },
  },
  'fal-ai/orpheus-tts': {
    provider: 'xeno',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    isAvailable: false,
    unavailableMessage: 'Orpheus TTS is not yet available on Xeno API. Please use an alternative TTS model.',
    defaultSettings: {
      voice: 'tara',
      temperature: 0.7,
      repetition_penalty: 1.2,
    },
  },
  'fal-ai/elevenlabs/tts/multilingual-v2': {
    provider: 'xeno',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    isAvailable: false,
    unavailableMessage: 'ElevenLabs TTS is not yet available on Xeno API. Please use an alternative TTS model.',
    defaultSettings: {
      voice: 'Rachel',
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      speed: 1,
      timestamps: false,
    },
  },
  'fal-ai/elevenlabs/tts/turbo-v2.5': {
    provider: 'xeno',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    isAvailable: false,
    unavailableMessage: 'ElevenLabs TTS Turbo is not yet available on Xeno API. Please use an alternative TTS model.',
    defaultSettings: {
      voice: 'Rachel',
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      speed: 1,
      timestamps: false,
    },
  },
  'fal-ai/mmaudio-v2/text-to-audio': {
    provider: 'xeno',
    xenoModelId: 'mmaudio-v2',
    isTextToSpeech: false,
    isMusicGeneration: true,
    isSoundEffects: true,
    isAvailable: true,
    defaultSettings: {
      num_steps: 25,
      duration: 8,
      cfg_strength: 4.5,
      mask_away_clip: false,
      negative_prompt: '',
    },
  },
  'cassetteai/sound-effects-generator': {
    provider: 'xeno',
    xenoModelId: 'cassette-ai',
    isTextToSpeech: false,
    isMusicGeneration: false,
    isSoundEffects: true,
    isAvailable: true,
    defaultSettings: {
      duration: 10,
    },
  },
  'fal-ai/lyria2': {
    provider: 'xeno',
    xenoModelId: 'lyria2',
    isTextToSpeech: false,
    isMusicGeneration: true,
    isSoundEffects: false,
    isAvailable: true,
    defaultSettings: {
      negative_prompt: '',
    },
  },
  'resemble-ai/chatterboxhd/speech-to-speech': {
    provider: 'xeno',
    isTextToSpeech: false,
    isMusicGeneration: false,
    isSoundEffects: false,
    isAvailable: false,
    unavailableMessage: 'Resemble AI ChatterboxHD Speech-to-Speech is not yet available on Xeno API.',
    defaultSettings: {
      target_voice: 'Aurora',
      high_quality_audio: false,
    },
  },
  'resemble-ai/chatterboxhd/text-to-speech': {
    provider: 'xeno',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    isAvailable: false,
    unavailableMessage: 'Resemble AI ChatterboxHD TTS is not yet available on Xeno API.',
    defaultSettings: {
      voice: 'Aurora',
      exaggeration: 0.5,
      high_quality_audio: false,
      temperature: 0.8,
      cfg: 0.5,
      seed: 0,
    },
  },
};

async function generateAudio(
  modelId: string,
  settings: AudioModelSettings,
  onQueueUpdate?: QueueUpdateCallback
): Promise<AudioGenerationResponse> {
  const startTime = Date.now();

  try {
    const modelDef = audioModelRegistry[modelId];
    if (!modelDef) {
      throw new Error(`Audio model ${modelId} is not supported`);
    }

    if (!modelDef.isAvailable) {
      throw new Error(modelDef.unavailableMessage || `Model ${modelId} is not available`);
    }

    const prompt = settings.prompt || settings.text || '';
    if (!prompt) {
      throw new Error(modelDef.isTextToSpeech ? 'Text is required for text-to-speech generation' : 'Prompt is required for audio generation');
    }

    const result = await postXenoRequest('/audio/generate', {
      prompt,
      model: modelDef.xenoModelId || 'auto',
      duration: settings.duration || modelDef.defaultSettings.duration,
      seed: settings.seed,
      wait: true,
    });

    const generationTime = Date.now() - startTime;

    if (result && result.data && result.data.length > 0) {
      const audioData = result.data[0];

      const generatedAudio: GeneratedAudio = {
        url: audioData.url,
        duration: audioData.duration,
        metadata: {
          model: modelId,
          generationTime,
          settings: settings,
          tags: audioData.tags,
          title: audioData.title,
        }
      };

      return {
        success: true,
        audio: generatedAudio,
        metadata: {
          generationTime,
          modelVersion: modelId,
          falInput: { prompt, model: modelDef.xenoModelId },
          falResult: result,
        }
      };
    } else {
      throw new Error('No audio was generated');
    }

  } catch (error) {
    const generationTime = Date.now() - startTime;

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      audio: null,
      metadata: {
        generationTime,
        modelVersion: modelId,
      }
    };
  }
}

function getAudioModelDefaults(modelId: string): Partial<AudioModelSettings> | null {
  const modelDef = audioModelRegistry[modelId];
  return modelDef ? modelDef.defaultSettings : null;
}

function getAvailableAudioModels(): string[] {
  return Object.keys(audioModelRegistry);
}

function isAudioModelSupported(modelId: string): boolean {
  return modelId in audioModelRegistry;
}

function getAudioModelInfo(modelId: string): AudioModelDefinition | null {
  return audioModelRegistry[modelId] || null;
}

// Available voices for Minimax Speech 02 HD
export const MINIMAX_VOICES = [
  { id: 'Wise_Woman', name: 'Wise Woman', description: 'Mature, authoritative female voice' },
  { id: 'Friendly_Person', name: 'Friendly Person', description: 'Warm, approachable neutral voice' },
  { id: 'Inspirational_girl', name: 'Inspirational Girl', description: 'Young, energetic female voice' },
  { id: 'Deep_Voice_Man', name: 'Deep Voice Man', description: 'Rich, deep male voice' },
  { id: 'Calm_Woman', name: 'Calm Woman', description: 'Soothing, peaceful female voice' },
  { id: 'Casual_Guy', name: 'Casual Guy', description: 'Relaxed, informal male voice' },
  { id: 'Lively_Girl', name: 'Lively Girl', description: 'Energetic, youthful female voice' },
  { id: 'Patient_Man', name: 'Patient Man', description: 'Steady, calm male voice' },
  { id: 'Young_Knight', name: 'Young Knight', description: 'Noble, heroic male voice' },
  { id: 'Determined_Man', name: 'Determined Man', description: 'Strong, resolute male voice' },
  { id: 'Lovely_Girl', name: 'Lovely Girl', description: 'Sweet, charming female voice' },
  { id: 'Decent_Boy', name: 'Decent Boy', description: 'Polite, well-mannered young male voice' },
  { id: 'Imposing_Manner', name: 'Imposing Manner', description: 'Commanding, authoritative voice' },
  { id: 'Elegant_Man', name: 'Elegant Man', description: 'Refined, sophisticated male voice' },
  { id: 'Abbess', name: 'Abbess', description: 'Spiritual, wise female voice' },
  { id: 'Sweet_Girl_2', name: 'Sweet Girl 2', description: 'Gentle, kind female voice' },
  { id: 'Exuberant_Girl', name: 'Exuberant Girl', description: 'Enthusiastic, vibrant female voice' },
];

// Available emotions for Minimax Speech 02 HD
export const MINIMAX_EMOTIONS = [
  { id: 'neutral', name: 'Neutral', description: 'Natural, emotionally balanced tone' },
  { id: 'happy', name: 'Happy', description: 'Joyful, cheerful tone' },
  { id: 'sad', name: 'Sad', description: 'Melancholic, sorrowful tone' },
  { id: 'angry', name: 'Angry', description: 'Intense, frustrated tone' },
  { id: 'fearful', name: 'Fearful', description: 'Anxious, worried tone' },
  { id: 'disgusted', name: 'Disgusted', description: 'Repulsed, distasteful tone' },
  { id: 'surprised', name: 'Surprised', description: 'Astonished, amazed tone' },
];

// Available voices for Orpheus TTS
export const ORPHEUS_VOICES = [
  { id: 'tara', name: 'Tara', description: 'Natural, versatile female voice' },
  { id: 'leah', name: 'Leah', description: 'Warm, friendly female voice' },
  { id: 'jess', name: 'Jess', description: 'Energetic, youthful female voice' },
  { id: 'leo', name: 'Leo', description: 'Confident, professional male voice' },
  { id: 'dan', name: 'Dan', description: 'Casual, approachable male voice' },
  { id: 'mia', name: 'Mia', description: 'Expressive, dynamic female voice' },
  { id: 'zac', name: 'Zac', description: 'Clear, articulate male voice' },
  { id: 'zoe', name: 'Zoe', description: 'Bright, cheerful female voice' },
];

// Available emotive tags for Orpheus TTS
export const ORPHEUS_EMOTIVE_TAGS = [
  { tag: '<laugh>', description: 'Laughter sound' },
  { tag: '<chuckle>', description: 'Light chuckling' },
  { tag: '<sigh>', description: 'Sighing sound' },
  { tag: '<cough>', description: 'Coughing sound' },
  { tag: '<sniffle>', description: 'Sniffling sound' },
  { tag: '<groan>', description: 'Groaning sound' },
  { tag: '<yawn>', description: 'Yawning sound' },
  { tag: '<gasp>', description: 'Gasping sound' },
];

// Available voices for ElevenLabs TTS Multilingual V2
export const ELEVENLABS_VOICES = [
  { id: 'Rachel', name: 'Rachel', description: 'Default professional female voice', gender: 'Female' },
  { id: 'Aria', name: 'Aria', description: 'Expressive female voice', gender: 'Female' },
  { id: 'Roger', name: 'Roger', description: 'Authoritative male voice', gender: 'Male' },
  { id: 'Sarah', name: 'Sarah', description: 'Warm female voice', gender: 'Female' },
  { id: 'Laura', name: 'Laura', description: 'Professional female voice', gender: 'Female' },
  { id: 'Charlie', name: 'Charlie', description: 'Friendly male voice', gender: 'Male' },
  { id: 'George', name: 'George', description: 'Distinguished male voice', gender: 'Male' },
  { id: 'Callum', name: 'Callum', description: 'Clear male voice', gender: 'Male' },
  { id: 'River', name: 'River', description: 'Smooth unisex voice', gender: 'Unisex' },
  { id: 'Liam', name: 'Liam', description: 'Young male voice', gender: 'Male' },
  { id: 'Charlotte', name: 'Charlotte', description: 'Elegant female voice', gender: 'Female' },
  { id: 'Alice', name: 'Alice', description: 'Bright female voice', gender: 'Female' },
  { id: 'Matilda', name: 'Matilda', description: 'Youthful female voice', gender: 'Female' },
  { id: 'Will', name: 'Will', description: 'Confident male voice', gender: 'Male' },
  { id: 'Jessica', name: 'Jessica', description: 'Professional female voice', gender: 'Female' },
  { id: 'Eric', name: 'Eric', description: 'Mature male voice', gender: 'Male' },
  { id: 'Chris', name: 'Chris', description: 'Casual male voice', gender: 'Male' },
  { id: 'Brian', name: 'Brian', description: 'Deep male voice', gender: 'Male' },
  { id: 'Daniel', name: 'Daniel', description: 'Clear male voice', gender: 'Male' },
  { id: 'Lily', name: 'Lily', description: 'Sweet female voice', gender: 'Female' },
  { id: 'Bill', name: 'Bill', description: 'Friendly male voice', gender: 'Male' },
];

// Available voices for Resemble AI ChatterboxHD Speech-to-Speech
export const RESEMBLE_AI_VOICES = [
  { id: 'Aurora', name: 'Aurora', description: 'Bright, ethereal female voice', gender: 'Female' },
  { id: 'Blade', name: 'Blade', description: 'Sharp, dynamic male voice', gender: 'Male' },
  { id: 'Britney', name: 'Britney', description: 'Youthful, energetic female voice', gender: 'Female' },
  { id: 'Carl', name: 'Carl', description: 'Steady, reliable male voice', gender: 'Male' },
  { id: 'Cliff', name: 'Cliff', description: 'Strong, authoritative male voice', gender: 'Male' },
  { id: 'Richard', name: 'Richard', description: 'Distinguished, mature male voice', gender: 'Male' },
  { id: 'Rico', name: 'Rico', description: 'Smooth, charismatic male voice', gender: 'Male' },
  { id: 'Siobhan', name: 'Siobhan', description: 'Elegant, sophisticated female voice', gender: 'Female' },
  { id: 'Vicky', name: 'Vicky', description: 'Friendly, approachable female voice', gender: 'Female' },
];

export {
  generateAudio,
  getAudioModelDefaults,
  getAvailableAudioModels,
  isAudioModelSupported,
  getAudioModelInfo,
  audioModelRegistry,
};
