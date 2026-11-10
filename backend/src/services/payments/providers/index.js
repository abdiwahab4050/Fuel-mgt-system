/**
 * Provider registry — picks the sandbox or live adapter per PAYMENT_MODE.
 */
import { env } from '../../../config/env.js';
import { createSandboxProvider } from './sandbox.js';
import { createLiveProvider, LIVE_REQUIREMENTS } from './live.js';

export const ELECTRONIC = ['ZAAD', 'EDAHAB', 'MASTERCARD'];
const cache = {};

export function getProvider(method) {
  if (!ELECTRONIC.includes(method)) throw new Error(`No payment provider for ${method}`);
  const key = `${env.PAYMENT_MODE}:${method}`;
  cache[key] ||= env.PAYMENT_MODE === 'sandbox' ? createSandboxProvider(method) : createLiveProvider(method);
  return cache[key];
}

// SECTION: public summary for the UI — never includes credential values
export function providerSummary({ includeRequirements = false } = {}) {
  return ELECTRONIC.map((method) => {
    const p = getProvider(method);
    const base = { method, label: p.label, flow: p.flow, mode: p.mode, available: p.available };
    if (!p.available) base.reason = p.unavailableReason;
    if (includeRequirements) {
      const r = LIVE_REQUIREMENTS[method];
      Object.assign(base, {
        requiredEnv: r.env,
        missingEnv: r.env.filter((k) => !process.env[k]),
        obtainFrom: r.obtainFrom,
        documents: r.documents,
        liveImplemented: false,
      });
    }
    return base;
  });
}
