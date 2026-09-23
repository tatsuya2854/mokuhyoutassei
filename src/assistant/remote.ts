import type { AssistantInput, AssistantPort, AssistantReply } from './port';

/**
 * 外部のAIにつなぐときの実装。
 *
 * ■ 鍵はフロントに置かない
 * 呼ぶのは自分のサーバーだけ。サーバーが鍵を持ち、そこから
 * LLMプロバイダを叩く。どのプロバイダを使うかもサーバー側の都合なので、
 * アプリ側は差し替えても何も変わらない。
 *
 * サーバー側の口は1つ：
 *   POST {base}/assistant  { text, ctx } -> { text, actions? }
 *
 * VITE_ASSISTANT_API を入れると有効になる。無ければ ready === false。
 */
export function remoteAssistant(baseUrl: string | undefined): AssistantPort {
  const base = (baseUrl ?? '').replace(/\/$/, '');
  return {
    id: 'remote',
    ready: base.length > 0,
    async reply(input: AssistantInput): Promise<AssistantReply> {
      const res = await fetch(`${base}/assistant`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`assistant failed: ${res.status}`);
      return (await res.json()) as AssistantReply;
    },
  };
}
