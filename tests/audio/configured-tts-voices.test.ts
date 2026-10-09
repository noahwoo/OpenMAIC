/**
 * An OpenAI-compatible speech server configured on the `openai-tts` preset
 * declares its own voices (`options.voices`) and audio format
 * (`options.format`): the voices replace OpenAI's catalogue wherever voices
 * are offered or picked, and the adapter asks for the configured format.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  configuredTTSVoices,
  openAITTSResponseFormat,
  providerDefaultVoice,
} from '@/lib/audio/configured-tts-voices';
import { generateTTS } from '@/lib/audio/tts-providers';
import { slotTTSProvidersConfig, ttsSelection } from '@/lib/audio/tts-selection';
import {
  getSelectableProvidersWithVoices,
  resolveNarratorVoiceBinding,
  resolveNarratorVoiceForGeneration,
} from '@/lib/audio/voice-resolver';
import { agentVoiceCatalog } from '@/lib/server/agent-runtime/roster-tools';
import type { EffectiveTarget, ModelCapabilities } from '@/lib/model-settings/capabilities';
import { clipVoice, type RunNarrationTarget } from '@/lib/server/generation/run/narration-voice';
import type { MediaConnection } from '@/lib/server/model-config/media';

const mockFetch = vi.hoisted(() => vi.fn() as Mock);
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const options = { voices: 'Vivian, Serena,,Ryan ', format: 'wav' };

const target: EffectiveTarget = {
  providerId: 'qwen-tts-local',
  providerSource: 'deployment',
  presetId: 'openai-tts',
  registryId: 'openai-tts',
  modelId: 'qwen3-tts',
  options,
};

const ids = (voices: Array<{ id: string }>) => voices.map((voice) => voice.id);

describe('configuredTTSVoices', () => {
  it('reads a comma-separated voice list, trimming blanks', () => {
    expect(ids(configuredTTSVoices(options) ?? [])).toEqual(['Vivian', 'Serena', 'Ryan']);
  });

  it('is undefined when no voices are declared', () => {
    expect(configuredTTSVoices(undefined)).toBeUndefined();
    expect(configuredTTSVoices({})).toBeUndefined();
    expect(configuredTTSVoices({ voices: ' , ' })).toBeUndefined();
    expect(configuredTTSVoices({ voices: 42 })).toBeUndefined();
  });
});

describe('providerDefaultVoice', () => {
  it('is the first declared voice, else the registry default', () => {
    expect(providerDefaultVoice('openai-tts', options)).toBe('Vivian');
    expect(providerDefaultVoice('openai-tts', undefined)).toBe('alloy');
  });
});

describe('openAITTSResponseFormat', () => {
  it('defaults to mp3 and accepts the formats a browser can decode', () => {
    expect(openAITTSResponseFormat(undefined)).toBe('mp3');
    expect(openAITTSResponseFormat({ format: 'WAV' })).toBe('wav');
    expect(openAITTSResponseFormat({ format: 'flac' })).toBe('flac');
  });

  it('refuses a format it cannot serve', () => {
    expect(() => openAITTSResponseFormat({ format: 'pcm' })).toThrow(/format/);
  });
});

describe('the voices offered for a configured server', () => {
  it('replaces the OpenAI catalogue with the declared voices', () => {
    const [provider] = getSelectableProvidersWithVoices(slotTTSProvidersConfig(target));
    expect(provider.providerId).toBe('openai-tts');
    expect(ids(provider.voices)).toEqual(['Vivian', 'Serena', 'Ryan']);
    expect(provider.modelGroups.map((group) => group.modelId)).toEqual(['qwen3-tts']);
    expect(ids(provider.modelGroups[0].voices)).toEqual(['Vivian', 'Serena', 'Ryan']);
  });

  it("narrates with the learner's declared voice, else the first declared voice", () => {
    const capabilities = { tts: target } as unknown as ModelCapabilities;
    expect(
      ttsSelection(capabilities, { voice: 'Ryan', providerId: 'openai-tts', speed: 1 })?.voice,
    ).toBe('Ryan');
    expect(
      ttsSelection(capabilities, { voice: 'alloy', providerId: 'openai-tts', speed: 1 })?.voice,
    ).toBe('Vivian');
  });
});

describe('run narration on a configured server', () => {
  const run: RunNarrationTarget = {
    connection: {
      providerId: 'openai-tts',
      modelId: 'qwen3-tts',
      managed: true,
      userEndpoint: false,
      origin: 'configuration',
      options,
    } as MediaConnection,
    providerId: 'openai-tts',
    modelId: 'qwen3-tts',
  };

  it('picks declared voices only', () => {
    const voiceOf = (voiceId?: string) =>
      clipVoice({
        target: run,
        preference: voiceId ? { providerId: 'openai-tts', voiceId } : undefined,
        bound: undefined,
        unavailable: new Set(),
      })?.voice.voiceId;
    expect(voiceOf()).toBe('Vivian');
    expect(voiceOf('Serena')).toBe('Serena');
    expect(voiceOf('alloy')).toBe('Vivian');
  });
});

describe('the openai-tts adapter', () => {
  beforeEach(() => mockFetch.mockReset());

  const audio = (contentType: string) => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]).buffer,
    headers: { get: () => contentType },
  });

  it('asks for the configured format', async () => {
    mockFetch.mockResolvedValueOnce(audio('audio/wav'));
    const result = await generateTTS(
      {
        providerId: 'openai-tts',
        apiKey: 'unused',
        baseUrl: 'http://127.0.0.1:8790/v1',
        modelId: 'qwen3-tts',
        voice: 'Vivian',
        providerOptions: options,
        // A server-configured provider may live on a local network.
        managed: true,
      },
      '你好',
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'qwen3-tts', voice: 'Vivian', response_format: 'wav' });
    expect(result.format).toBe('wav');
  });

  it('still asks for mp3 by default', async () => {
    mockFetch.mockResolvedValueOnce(audio('audio/mpeg'));
    await generateTTS({ providerId: 'openai-tts', apiKey: 'k', voice: 'alloy' }, 'hi');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).response_format).toBe('mp3');
  });
});

describe('voices bound before the server declared its own', () => {
  const configs = {
    'openai-tts': {
      apiKey: '',
      baseUrl: '',
      enabled: true,
      isServerConfigured: true,
      modelId: 'qwen3-tts',
      providerOptions: options,
    },
  };
  const globalVoice = { providerId: 'openai-tts' as const, voiceId: 'Vivian' };

  it('narrate with the global voice instead of an undeclared bound voice', () => {
    expect(
      resolveNarratorVoiceBinding(
        { providerId: 'openai-tts', voiceId: 'alloy' },
        globalVoice,
        configs,
      ).voiceId,
    ).toBe('Vivian');
    expect(
      resolveNarratorVoiceBinding(
        { providerId: 'openai-tts', voiceId: 'Ryan' },
        globalVoice,
        configs,
      ).voiceId,
    ).toBe('Ryan');
  });

  it('are never pinned at agent generation', () => {
    expect(
      resolveNarratorVoiceForGeneration('openai-tts', 'alloy', configs['openai-tts']),
    ).toBeUndefined();
    expect(
      resolveNarratorVoiceForGeneration('openai-tts', 'Serena', configs['openai-tts'])?.voiceId,
    ).toBe('Serena');
  });
});

describe('the agent voice catalogue', () => {
  it('offers the declared voices of the tts slot', () => {
    const catalog = agentVoiceCatalog([], {
      providerId: 'openai-tts',
      apiKey: 'unused',
      managed: true,
      userEndpoint: false,
      origin: 'configuration',
      options,
    } as MediaConnection);
    expect(catalog.map((voice) => voice.id)).toEqual(['Vivian', 'Serena', 'Ryan']);
  });
});
