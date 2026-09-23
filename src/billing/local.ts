import type { BillingPort, CheckoutResult } from './port';
import type { Cycle, PlanId, Subscription } from '../domain/entitlements';
import { addDays, todayISO } from '../lib/date';

const KEY = 'mokuhyou-billing-v1';

/**
 * 決済サーバーが無いときの実装。
 *
 * 課金は起こさない。プランを切り替えて挙動を確かめるためだけのもの。
 * 本番でサーバーを立てたら stripeBilling に差し替える。
 */
export const localBilling: BillingPort = {
  id: 'local',
  ready: true,

  async getSubscription() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Subscription) : null;
    } catch {
      return null;
    }
  },

  async startCheckout({ planId, cycle }: { planId: PlanId; cycle: Cycle }): Promise<CheckoutResult> {
    const today = todayISO();
    const sub: Subscription = {
      planId,
      cycle,
      status: 'active',
      renewsOn: addDays(today, cycle === 'yearly' ? 365 : 30),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(sub));
    } catch {
      /* 保存できなくても状態は返す */
    }
    return { subscription: sub };
  },

  async openPortal() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
    return {};
  },
};

/** 起動時に無料期間を保存する（ローカル実装のときだけ意味がある） */
export function persistLocal(sub: Subscription | null) {
  try {
    if (sub) localStorage.setItem(KEY, JSON.stringify(sub));
    else localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
