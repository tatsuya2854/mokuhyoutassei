import type { Cycle, PlanId, Subscription } from '../domain/entitlements';

/**
 * 決済の差し込み口。
 *
 * アプリ本体は「checkout を始めて」「今どのプラン？」しか言わない。
 * Stripe でも他でも、ここを差し替えるだけで済むようにしてある。
 *
 * ■ 鍵について
 * このインターフェースの実装は、**秘密鍵を一切受け取らない**。
 * Stripe の secret key / webhook secret はサーバー側だけが持つ。
 * フロントが知っていいのは「自分のサーバーのURL」だけ。
 */
export interface BillingPort {
  /** 差し替えたときにどれが動いているか分かるようにする */
  readonly id: string;
  /** いま使える実装か（サーバー未設定ならローカルに落とす） */
  readonly ready: boolean;
  /** 現在の加入状態を取りに行く */
  getSubscription(): Promise<Subscription | null>;
  /** 申し込みを始める。外部の決済画面に飛ぶ場合は url が返る */
  startCheckout(input: { planId: PlanId; cycle: Cycle }): Promise<CheckoutResult>;
  /** 解約・支払い方法の変更。外部ポータルに飛ぶ場合は url が返る */
  openPortal(): Promise<{ url?: string }>;
}

export interface CheckoutResult {
  /** 外部の決済ページに飛ばす場合 */
  url?: string;
  /** その場で確定した場合（ローカル実装や、サーバーで完結した場合） */
  subscription?: Subscription;
}
