import type { BillingPort, CheckoutResult } from './port';
import type { Cycle, PlanId, Subscription } from '../domain/entitlements';

/**
 * Stripe をつなぐときの実装。
 *
 * ■ フロントには鍵を置かない
 * ここが呼ぶのは「自分のサーバー」だけ。Stripe の secret key は
 * サーバーの環境変数にしか置かない。publishable key ですら
 * この実装は必要としない（Checkout のURLはサーバーが作って返す）。
 *
 * 必要なサーバー側の口は3つだけ：
 *   GET  {base}/subscription          -> Subscription | null
 *   POST {base}/checkout {planId,cycle} -> { url }
 *   POST {base}/portal                -> { url }
 *
 * VITE_BILLING_API に自分のサーバーのURLを入れると有効になる。
 * 入っていなければ ready === false になり、アプリは localBilling に落ちる。
 */
export function stripeBilling(baseUrl: string | undefined): BillingPort {
  const base = (baseUrl ?? '').replace(/\/$/, '');

  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      // 認証はサーバーが発行する HttpOnly Cookie で行う。
      // トークンを JS から触れる場所に置かないための選択。
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!res.ok) throw new Error(`billing ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  };

  return {
    id: 'stripe',
    ready: base.length > 0,

    async getSubscription() {
      return call<Subscription | null>('/subscription');
    },

    async startCheckout(input: { planId: PlanId; cycle: Cycle }): Promise<CheckoutResult> {
      return call<CheckoutResult>('/checkout', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    async openPortal() {
      return call<{ url?: string }>('/portal', { method: 'POST' });
    },
  };
}
