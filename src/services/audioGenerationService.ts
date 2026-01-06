// Import statements first
import * as falImport from '@fal-ai/client';
import minimaxSpeech02HdSchema from '../components/playground/Generation/Minimax/minimax-speech-02-hd-schema.json';
import orpheusTtsSchema from '../components/playground/Generation/Orpheus/orpheus-tts-schema.json';
import elevenlabsTtsMultilingualV2Schema from '../components/playground/Generation/ElevenLabs/elevenlabs-tts-multilingual-v2-schema.json';
import elevenlabsTtsTurboV25Schema from '../components/playground/Generation/ElevenLabs/elevenlabs-tts-turbo-v2.5-schema.json';
import mmaudioV2TextToAudioSchema from '../components/playground/Generation/MMAudio/mmaudio-v2-text-to-audio-schema.json';
import cassetteaiSoundEffectsGeneratorSchema from '../components/playground/Generation/CassetteAI/cassetteai-sound-effects-generator-schema.json';
import lyria2Schema from '../components/playground/Generation/Lyria/lyria2-schema.json';

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

// Get environment variables
const FAL_KEY = import.meta.env.VITE_FAL_KEY;

// Initialize the fal client properly
const { createFalClient } = falImport;
const fal = createFalClient({
  credentials: FAL_KEY,
});

console.log("Initialized Fal.ai client for audio generation:", fal);

interface AudioModelDefinition {
  provider: 'fal';
  falModelId: string;
  isTextToSpeech?: boolean;
  isMusicGeneration?: boolean;
  isSoundEffects?: boolean;
  defaultSettings: Partial<AudioModelSettings>;
  schema?: any;
}

type QueueUpdateCallback = (update: any) => void;

if (!FAL_KEY) {
  console.warn('Fal AI key (VITE_FAL_KEY) is not set. Fal.ai audio models will not work.');
}

const audioModelRegistry: Record<string, AudioModelDefinition> = {
  'fal-ai/minimax/speech-02-hd': {
    provider: 'fal',
    falModelId: 'fal-ai/minimax/speech-02-hd',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    schema: minimaxSpeech02HdSchema,
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
    provider: 'fal',
    falModelId: 'fal-ai/orpheus-tts',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    schema: orpheusTtsSchema,
    defaultSettings: {
      voice: 'tara',
      temperature: 0.7,
      repetition_penalty: 1.2,
    },
  },
  'fal-ai/elevenlabs/tts/multilingual-v2': {
    provider: 'fal',
    falModelId: 'fal-ai/elevenlabs/tts/multilingual-v2',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    schema: elevenlabsTtsMultilingualV2Schema,
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
    provider: 'fal',
    falModelId: 'fal-ai/elevenlabs/tts/turbo-v2.5',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
    schema: elevenlabsTtsTurboV25Schema,
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
    provider: 'fal',
    falModelId: 'fal-ai/mmaudio-v2/text-to-audio',
    isTextToSpeech: false,
    isMusicGeneration: true,
    isSoundEffects: true,
    schema: mmaudioV2TextToAudioSchema,
    defaultSettings: {
      num_steps: 25,
      duration: 8,
      cfg_strength: 4.5,
      mask_away_clip: false,
      negative_prompt: '',
    },
  },
  'cassetteai/sound-effects-generator': {
    provider: 'fal',
    falModelId: 'cassetteai/sound-effects-generator',
    isTextToSpeech: false,
    isMusicGeneration: false,
    isSoundEffects: true,
    schema: cassetteaiSoundEffectsGeneratorSchema,
    defaultSettings: {
      duration: 10,
    },
  },
  'fal-ai/lyria2': {
    provider: 'fal',
    falModelId: 'fal-ai/lyria2',
    isTextToSpeech: false,
    isMusicGeneration: true,
    isSoundEffects: false,
    schema: lyria2Schema,
    defaultSettings: {
      negative_prompt: '',
    },
  },
  'resemble-ai/chatterboxhd/speech-to-speech': {
    provider: 'fal',
    falModelId: 'resemble-ai/chatterboxhd/speech-to-speech',
    isTextToSpeech: false,
    isMusicGeneration: false,
    isSoundEffects: false,
    defaultSettings: {
      target_voice: 'Aurora',
      high_quality_audio: false,
    },
  },
  'resemble-ai/chatterboxhd/text-to-speech': {
    provider: 'fal',
    falModelId: 'resemble-ai/chatterboxhd/text-to-speech',
    isTextToSpeech: true,
    isMusicGeneration: false,
    isSoundEffects: false,
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

function mapAudioSettingsToFalInput(settings: AudioModelSettings, falModelId: string): Record<string, any> {
  const input: Record<string, any> = {};
  const modelDef = audioModelRegistry[falModelId];

  // Common text handling for all TTS models
  if (settings.text) {
    input.text = settings.text;
  } else if (settings.prompt) {
    input.text = settings.prompt; // Map prompt to text for TTS
  }

  // Handle Minimax Speech 02 HD specifically
  if (falModelId === 'fal-ai/minimax/speech-02-hd') {
    // Voice settings
    if (settings.voice_setting) {
      input.voice_setting = {
        ...modelDef?.defaultSettings.voice_setting,
        ...settings.voice_setting,
      };
    } else {
      input.voice_setting = modelDef?.defaultSettings.voice_setting;
    }

    // Language boost
    if (settings.language_boost) {
      input.language_boost = settings.language_boost;
    } else {
      input.language_boost = modelDef?.defaultSettings.language_boost;
    }

    // Output format
    input.output_format = settings.output_format || modelDef?.defaultSettings.output_format || 'url';

    // Audio settings
    if (settings.audio_setting) {
      input.audio_setting = {
        ...modelDef?.defaultSettings.audio_setting,
        ...settings.audio_setting,
      };
    } else {
      input.audio_setting = modelDef?.defaultSettings.audio_setting;
    }

    // Pronunciation dictionary
    if (settings.pronunciation_dict) {
      input.pronunciation_dict = settings.pronunciation_dict;
    }
  }
  
  // Handle Orpheus TTS specifically
  else if (falModelId === 'fal-ai/orpheus-tts') {
    // Voice selection
    if (settings.voice) {
      input.voice = settings.voice;
    } else {
      input.voice = modelDef?.defaultSettings.voice || 'tara';
    }

    // Temperature control
    if (settings.temperature !== undefined) {
      input.temperature = settings.temperature;
    } else {
      input.temperature = modelDef?.defaultSettings.temperature || 0.7;
    }

    // Repetition penalty
    if (settings.repetition_penalty !== undefined) {
      input.repetition_penalty = settings.repetition_penalty;
    } else {
      input.repetition_penalty = modelDef?.defaultSettings.repetition_penalty || 1.2;
    }
  }
  
  // Handle ElevenLabs TTS Multilingual V2 specifically
  else if (falModelId === 'fal-ai/elevenlabs/tts/multilingual-v2') {
    // Voice selection
    if (settings.voice) {
      input.voice = settings.voice;
    } else {
      input.voice = modelDef?.defaultSettings.voice || 'Rachel';
    }

    // Stability control
    if (settings.stability !== undefined) {
      input.stability = settings.stability;
    } else {
      input.stability = modelDef?.defaultSettings.stability || 0.5;
    }

    // Similarity boost
    if (settings.similarity_boost !== undefined) {
      input.similarity_boost = settings.similarity_boost;
    } else {
      input.similarity_boost = modelDef?.defaultSettings.similarity_boost || 0.75;
    }

    // Style control
    if (settings.style !== undefined) {
      input.style = settings.style;
    } else {
      input.style = modelDef?.defaultSettings.style || 0;
    }

    // Speed control
    if (settings.speed !== undefined) {
      input.speed = settings.speed;
    } else {
      input.speed = modelDef?.defaultSettings.speed || 1;
    }

    // Timestamps (API uses 'timstamps' with typo for multilingual-v2)
    if (settings.timestamps !== undefined) {
      input.timstamps = settings.timestamps;
    } else {
      input.timstamps = modelDef?.defaultSettings.timestamps || false;
    }
  }
  
  // Handle ElevenLabs TTS Turbo V2.5 specifically
  else if (falModelId === 'fal-ai/elevenlabs/tts/turbo-v2.5') {
    // Voice selection
    if (settings.voice) {
      input.voice = settings.voice;
    } else {
      input.voice = modelDef?.defaultSettings.voice || 'Rachel';
    }

    // Stability control
    if (settings.stability !== undefined) {
      input.stability = settings.stability;
    } else {
      input.stability = modelDef?.defaultSettings.stability || 0.5;
    }

    // Similarity boost
    if (settings.similarity_boost !== undefined) {
      input.similarity_boost = settings.similarity_boost;
    } else {
      input.similarity_boost = modelDef?.defaultSettings.similarity_boost || 0.75;
    }

    // Style control
    if (settings.style !== undefined) {
      input.style = settings.style;
    } else {
      input.style = modelDef?.defaultSettings.style || 0;
    }

    // Speed control
    if (settings.speed !== undefined) {
      input.speed = settings.speed;
    } else {
      input.speed = modelDef?.defaultSettings.speed || 1;
    }

    // Timestamps (Turbo V2.5 uses correct spelling 'timestamps')
    if (settings.timestamps !== undefined) {
      input.timestamps = settings.timestamps;
    } else {
      input.timestamps = modelDef?.defaultSettings.timestamps || false;
    }
  }
  
  // Handle MMAudio V2 Text-to-Audio specifically
  else if (falModelId === 'fal-ai/mmaudio-v2/text-to-audio') {
    // Use prompt field for this model
    if (settings.prompt || settings.text) {
      input.prompt = settings.prompt || settings.text;
    }

    // Number of steps
    if (settings.num_steps !== undefined) {
      input.num_steps = settings.num_steps;
    } else {
      input.num_steps = modelDef?.defaultSettings.num_steps || 25;
    }

    // Duration
    if (settings.duration !== undefined) {
      input.duration = settings.duration;
    } else {
      input.duration = modelDef?.defaultSettings.duration || 8;
    }

    // CFG Strength
    if (settings.cfg_strength !== undefined) {
      input.cfg_strength = settings.cfg_strength;
    } else {
      input.cfg_strength = modelDef?.defaultSettings.cfg_strength || 4.5;
    }

    // Seed
    if (settings.seed !== undefined && settings.seed >= 0) {
      input.seed = settings.seed;
    }

    // Mask away clip
    if (settings.mask_away_clip !== undefined) {
      input.mask_away_clip = settings.mask_away_clip;
    } else {
      input.mask_away_clip = modelDef?.defaultSettings.mask_away_clip || false;
    }

    // Negative prompt
    if (settings.negative_prompt !== undefined) {
      input.negative_prompt = settings.negative_prompt;
    } else {
      input.negative_prompt = modelDef?.defaultSettings.negative_prompt || '';
    }
  }
  
  // Handle CassetteAI Sound Effects Generator specifically
  else if (falModelId === 'cassetteai/sound-effects-generator') {
    // Use prompt field for this model
    if (settings.prompt || settings.text) {
      input.prompt = settings.prompt || settings.text;
    }

    // Duration (required parameter)
    if (settings.duration !== undefined) {
      input.duration = Math.round(settings.duration); // Ensure integer
    } else {
      input.duration = Math.round(modelDef?.defaultSettings.duration || 10);
    }
  }
  
  // Handle Lyria2 specifically
  else if (falModelId === 'fal-ai/lyria2') {
    // Use prompt field for this model
    if (settings.prompt || settings.text) {
      input.prompt = settings.prompt || settings.text;
    }

    // Negative prompt
    if (settings.negative_prompt !== undefined) {
      input.negative_prompt = settings.negative_prompt;
    } else {
      input.negative_prompt = modelDef?.defaultSettings.negative_prompt || '';
    }

    // Seed
    if (settings.seed !== undefined && settings.seed >= 0) {
      input.seed = settings.seed;
    }
  }
  
  // Handle Resemble AI ChatterboxHD Speech-to-Speech specifically
  else if (falModelId === 'resemble-ai/chatterboxhd/speech-to-speech') {
    // Source audio URL (required)
    if (settings.source_audio_url) {
      input.source_audio_url = settings.source_audio_url;
    } else {
      throw new Error('Source audio URL is required for speech-to-speech conversion');
    }

    // Target voice (optional, defaults to random if not provided)
    if (settings.target_voice) {
      input.target_voice = settings.target_voice;
    } else if (modelDef?.defaultSettings.target_voice) {
      input.target_voice = modelDef.defaultSettings.target_voice;
    }

    // Target voice audio URL (optional, overrides target_voice if provided)
    if (settings.target_voice_audio_url) {
      input.target_voice_audio_url = settings.target_voice_audio_url;
    }

    // High quality audio (optional, defaults to false)
    if (settings.high_quality_audio !== undefined) {
      input.high_quality_audio = settings.high_quality_audio;
    } else {
      input.high_quality_audio = modelDef?.defaultSettings.high_quality_audio || false;
    }
  }
  
  // Handle Resemble AI ChatterboxHD Text-to-Speech specifically
  else if (falModelId === 'resemble-ai/chatterboxhd/text-to-speech') {
    // Voice selection (optional, uses random if not provided)
    if (settings.voice) {
      input.voice = settings.voice;
    } else if (modelDef?.defaultSettings.voice) {
      input.voice = modelDef.defaultSettings.voice;
    }

    // Custom voice audio URL (optional, overrides voice selection)
    if (settings.audio_url) {
      input.audio_url = settings.audio_url;
    }

    // Exaggeration control (emotion intensity)
    if (settings.exaggeration !== undefined) {
      input.exaggeration = settings.exaggeration;
    } else {
      input.exaggeration = modelDef?.defaultSettings.exaggeration || 0.5;
    }

    // Temperature control (randomness)
    if (settings.temperature !== undefined) {
      input.temperature = settings.temperature;
    } else {
      input.temperature = modelDef?.defaultSettings.temperature || 0.8;
    }

    // CFG (Classifier-free guidance scale)
    if (settings.cfg !== undefined) {
      input.cfg = settings.cfg;
    } else {
      input.cfg = modelDef?.defaultSettings.cfg || 0.5;
    }

    // High quality audio
    if (settings.high_quality_audio !== undefined) {
      input.high_quality_audio = settings.high_quality_audio;
    } else {
      input.high_quality_audio = modelDef?.defaultSettings.high_quality_audio || false;
    }

    // Seed for reproducibility
    if (settings.seed !== undefined && settings.seed >= 0) {
      input.seed = settings.seed;
    } else {
      input.seed = modelDef?.defaultSettings.seed || 0;
    }
  }

  console.log(`Mapped audio settings for ${falModelId}:`, input);
  return input;
}

async function generateAudio(
  modelId: string,
  settings: AudioModelSettings,
  onQueueUpdate?: QueueUpdateCallback
): Promise<AudioGenerationResponse> {
  const startTime = Date.now();

  try {
    console.log(`Starting audio generation with model: ${modelId}`);
    console.log('Audio settings:', settings);

    // Check if model is supported
    const modelDef = audioModelRegistry[modelId];
    if (!modelDef) {
      throw new Error(`Audio model ${modelId} is not supported`);
    }

    if (!FAL_KEY) {
      throw new Error('Fal AI key is not configured. Please check your environment variables.');
    }

    // Map settings to fal input format
    const falInput = mapAudioSettingsToFalInput(settings, modelId);
    console.log('Fal input:', falInput);

    // Validate required fields
    if (modelDef.isTextToSpeech && !falInput.text) {
      throw new Error('Text is required for text-to-speech generation');
    }
    
    // Speech-to-speech models require source_audio_url instead of text/prompt
    if (modelId === 'resemble-ai/chatterboxhd/speech-to-speech') {
      if (!falInput.source_audio_url) {
        throw new Error('Source audio URL is required for speech-to-speech conversion');
      }
    } else if (modelId === 'resemble-ai/chatterboxhd/text-to-speech') {
      if (!falInput.text) {
        throw new Error('Text is required for text-to-speech generation');
      }
    } else if (!modelDef.isTextToSpeech && !falInput.prompt) {
      throw new Error('Prompt is required for audio generation');
    }

    // Submit to fal.ai queue
    console.log(`Submitting to fal.ai: ${modelDef.falModelId}`);
    
    const result = await fal.subscribe(modelDef.falModelId, {
      input: falInput,
      onQueueUpdate: (update) => {
        console.log('Queue update:', update);
        if (onQueueUpdate) {
          onQueueUpdate(update);
        }
      },
    });

    console.log('Fal.ai result:', result);

    const generationTime = Date.now() - startTime;

    // Process the result
    if (result && result.data) {
      const data = result.data;

      // Handle audio output
      let generatedAudio: GeneratedAudio | null = null;

      if (data.audio || data.audio_file) {
        const audioData = data.audio || data.audio_file;
        generatedAudio = {
          url: audioData.url,
          duration: data.duration_ms ? Math.round(data.duration_ms / 1000) : undefined,
          duration_ms: data.duration_ms,
          file_size: audioData.file_size,
          content_type: audioData.content_type,
          metadata: {
            model: modelId,
            generationTime,
            settings: settings,
          }
        };
      }

      if (!generatedAudio) {
        throw new Error('No audio was generated');
      }

      return {
        success: true,
        audio: generatedAudio,
        metadata: {
          generationTime,
          modelVersion: modelId,
          falInput,
          falResult: data,
        }
      };
    } else {
      throw new Error('No result data received from fal.ai');
    }

  } catch (error) {
    console.error(`Audio generation failed for model ${modelId}:`, error);
    const generationTime = Date.now() - startTime;
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      audio: null,
      metadata: {
        generationTime,
        modelVersion: modelId,
        falInput: mapAudioSettingsToFalInput(settings, modelId),
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