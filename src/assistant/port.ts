import type { ChatAction, DayLog, Plan, Profile, Task } from '../types';
import type { Memory } from '../domain/memory';
import type { Progress } from '../domain/progress';

/**
 * AI秘書の差し込み口。
 *
 * 既定は端末内で完結するルール実装。外部のLLMに差し替えたくなったら
 * この形に合わせた実装を足して、`assistant` の中身を入れ替えるだけでいい。
 *
 * ■ 鍵について
 * 外部APIを使う実装を作る場合でも、APIキーはフロントに置かない。
 * 必ず自分のサーバーを経由させる（サーバーが鍵を持ち、フロントは
 * 自分のサーバーのURLしか知らない）。
 */
export interface AssistantPort {
  readonly id: string;
  /** 使える状態か。サーバー未設定の実装は false を返す */
  readonly ready: boolean;
  /** その場の状況を見て、ひとこと返す */
  reply(input: AssistantInput): Promise<AssistantReply>;
}

export interface AssistantInput {
  text: string;
  ctx: AssistantContext;
}

/** 秘書が見ていい情報。これ以上は渡さない */
export interface AssistantContext {
  profile: Profile;
  plan: Plan;
  progress: Progress;
  memory: Memory;
  today: string;
  tasks: Task[];
  log: DayLog | null;
  /** 直近の会話（多くても数往復） */
  history: { role: 'user' | 'assistant'; text: string }[];
}

export interface AssistantReply {
  text: string;
  actions?: ChatAction[];
}
