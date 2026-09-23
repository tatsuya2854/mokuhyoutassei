import type { BillingPort } from './port';
import { localBilling } from './local';
import { stripeBilling } from './stripe';

export type { BillingPort, CheckoutResult } from './port';
export { localBilling, persistLocal } from './local';
export { stripeBilling } from './stripe';

/**
 * 実際に使う実装をここで1回だけ決める。
 * アプリのどこからも `billing` としか見えないので、差し替えはこの1行で済む。
 *
 * VITE_BILLING_API はサーバーのURL。**鍵ではない**。
 * 鍵をこのファイルに書くことは絶対にしない。
 */
const remote = stripeBilling(import.meta.env.VITE_BILLING_API as string | undefined);

export const billing: BillingPort = remote.ready ? remote : localBilling;
