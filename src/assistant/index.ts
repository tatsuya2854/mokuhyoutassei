import type { AssistantPort } from './port';
import { localAssistant } from './local';
import { remoteAssistant } from './remote';

export type { AssistantPort, AssistantContext, AssistantInput, AssistantReply } from './port';
export { localAssistant } from './local';
export { remoteAssistant } from './remote';
export { voice, webSpeechVoice } from './voice';
export type { VoicePort, ListenHandlers } from './voice';

/**
 * 実際に使う秘書をここで1回だけ決める。
 * VITE_ASSISTANT_API はサーバーのURL。**鍵ではない**。
 */
const remote = remoteAssistant(import.meta.env.VITE_ASSISTANT_API as string | undefined);

export const assistant: AssistantPort = remote.ready ? remote : localAssistant;
