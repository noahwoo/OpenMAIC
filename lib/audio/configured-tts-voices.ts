/**
 * What a speech provider's own options (openmaic.yml `options`) say about its
 * voices and audio, for an OpenAI-compatible server on the `openai-tts`
 * preset that is not OpenAI:
 *
 *   - `voices`: comma-separated voice ids. They replace the registry's
 *     catalogue wherever voices are offered or a default voice is picked.
 *   - `format`: the `response_format` the adapter asks for (default mp3).
 *
 * Client-safe: the browser and the server read the same options.
 */
import { DEFAULT_TTS_VOICES, TTS_PROVIDERS } from './constants';
import type { BuiltInTTSProviderId, TTSVoiceInfo } from './types';

type ProviderOptions = Record<string, unknown> | undefined;

/** Formats a browser can decode from a container with a header (not raw pcm). */
export const OPENAI_TTS_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav'] as const;

/** Whether an `options.format` value names a format the adapter can request (unset: mp3). */
export function isOpenAITTSFormat(value: unknown): boolean {
  if (value === undefined || value === '') return true;
  return (OPENAI_TTS_FORMATS as readonly string[]).includes(String(value).trim().toLowerCase());
}

/** The voices `options.voices` declares, or undefined when it declares none. */
export function configuredTTSVoices(options: ProviderOptions): TTSVoiceInfo[] | undefined {
  const raw = options?.voices;
  if (typeof raw !== 'string') return undefined;
  const voiceIds = raw
    .split(',')
    .map((voiceId) => voiceId.trim())
    .filter((voiceId) => voiceId.length > 0);
  if (voiceIds.length === 0) return undefined;
  return voiceIds.map((voiceId) => ({ id: voiceId, name: voiceId, language: 'auto' }));
}

/** The voices a provider offers: its declared ones, else its registry catalogue. */
export function providerTTSVoices(providerId: string, options: ProviderOptions): TTSVoiceInfo[] {
  return (
    configuredTTSVoices(options) ?? TTS_PROVIDERS[providerId as BuiltInTTSProviderId]?.voices ?? []
  );
}

/** A provider's default voice: its first declared one, else the registry default ('' if none). */
export function providerDefaultVoice(providerId: string, options: ProviderOptions): string {
  return (
    configuredTTSVoices(options)?.[0].id ??
    DEFAULT_TTS_VOICES[providerId as BuiltInTTSProviderId] ??
    ''
  );
}

/** Whether a provider offers a voice: any voice unless it declares its own list. */
export function providerOffersVoice(options: ProviderOptions, voiceId: string): boolean {
  const declared = configuredTTSVoices(options);
  return !declared || declared.some((voice) => voice.id === voiceId);
}

/** The `response_format` an OpenAI-compatible speech request asks for. */
export function openAITTSResponseFormat(options: ProviderOptions): string {
  const raw = options?.format;
  if (raw === undefined || raw === '') return 'mp3';
  if (!isOpenAITTSFormat(raw)) {
    throw new Error(
      `Unsupported TTS audio format "${String(raw)}" in the provider's options.format ` +
        `(expected one of ${OPENAI_TTS_FORMATS.join(', ')})`,
    );
  }
  return String(raw).trim().toLowerCase();
}
