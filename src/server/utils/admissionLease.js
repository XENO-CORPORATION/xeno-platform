/**
 * Admission lease: the platform grants the output ceiling an account can fund, instead of refusing a
 * request whose worst case it cannot.
 *
 * Decision: `XENO ADMISSION - LEASE DECISION.md` §3. The grant is the authorisation. The provider is told the
 * granted ceiling and nothing larger, so the hold covers everything the provider is allowed to produce.
 *
 * Pure: no database and no clock. The ledger calls leaseOutput() inside the hold transaction with the
 * spendable amount it has just read under the account lock, so the decision and the reservation are one act.
 */
import { chatInputCostMicro, chatOutputRateMicro, estimateChatCostMicro } from './creditCosts.js';

/**
 * Below this many output tokens a design turn cannot finish a useful reply, so the platform refuses before any
 * provider call. The number is a bet (decision §3.2), measured nowhere yet. It applies to min(requested, floor):
 * a caller that asks for less than the floor is never refused for asking small.
 */
export const LEASE_FLOOR_OUTPUT_TOKENS = 4096;

/** The ceiling a request without a usable max_tokens asks for. Matches the route default. */
const DEFAULT_REQUESTED_OUTPUT_TOKENS = 4096;

/** A usable requested ceiling is a whole number of at least one token. Anything else takes the default. */
export function normalizeRequestedOutputTokens(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_REQUESTED_OUTPUT_TOKENS;
}

/** Money as a non-negative BigInt. Anything that is not a positive amount spends nothing. */
function toMicro(value) {
  if (typeof value === 'bigint') return value > 0n ? value : 0n;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? BigInt(n) : 0n;
}

/**
 * Grant the account the largest output ceiling its spendable funds cover, never above what was asked.
 *
 * @param {object} p
 * @param {bigint|number} p.spendableMicro  what this request may spend, already net of holds, eligible lots and
 *        spend caps. The ledger computes it under the account lock.
 * @param {string} p.model
 * @param {number} p.inputTokens            the caller's input estimate, priced exactly as the estimator prices it
 * @param {number} p.requestedOutputTokens  the ceiling the caller asked for
 * @returns {{ refused: true, reason: 'unaffordable' | 'floor' }
 *   | { refused: false, amountMicro: number, grantedOutputTokens: number, requestedOutputTokens: number, capped: boolean }}
 */
export function leaseOutput({ spendableMicro, model, inputTokens = 0, requestedOutputTokens }) {
  const requested = normalizeRequestedOutputTokens(requestedOutputTokens);
  const spendable = toMicro(spendableMicro);
  const inputCost = BigInt(chatInputCostMicro(model, { inputTokens }));
  const rate = BigInt(chatOutputRateMicro(model));
  if (spendable < inputCost) return { refused: true, reason: 'unaffordable' };
  // A model that charges nothing per output token can always afford the ceiling it asked for.
  const affordable = rate === 0n ? BigInt(requested) : (spendable - inputCost) / rate;
  const granted = affordable < BigInt(requested) ? affordable : BigInt(requested);
  if (granted < BigInt(Math.min(requested, LEASE_FLOOR_OUTPUT_TOKENS))) return { refused: true, reason: 'floor' };
  const amountMicro = estimateChatCostMicro(model, { inputTokens, maxOutputTokens: Number(granted) });
  // The estimator's 0.05-credit minimum can lift a tiny reservation above what is left. Refuse rather than over-reserve.
  if (BigInt(amountMicro) > spendable) return { refused: true, reason: 'unaffordable' };
  // The ceiling is read back from the amount that was reserved, so a replay of this hold grants the same number.
  const reserved = grantedOutputTokensForAmount({ amountMicro, model, inputTokens, requestedOutputTokens: requested });
  return { refused: false, amountMicro, grantedOutputTokens: reserved, requestedOutputTokens: requested, capped: reserved < requested };
}

/**
 * The output ceiling a reserved amount covers, read back from the amount. A replayed hold and the settle path use
 * this, so the ceiling a retry sends upstream is the one the original hold reserved. For every amount the lease
 * issued it is exact, because the estimator is linear in output tokens. The one exception is the 0.05-credit
 * minimum, which can lift a tiny reservation; there the read-back can be a little higher, never above what was asked.
 */
export function grantedOutputTokensForAmount({ amountMicro, model, inputTokens = 0, requestedOutputTokens }) {
  const requested = normalizeRequestedOutputTokens(requestedOutputTokens);
  const rate = BigInt(chatOutputRateMicro(model));
  if (rate === 0n) return requested;
  const above = toMicro(amountMicro) - BigInt(chatInputCostMicro(model, { inputTokens }));
  const covered = above > 0n ? above / rate : 0n;
  const granted = covered < BigInt(requested) ? covered : BigInt(requested);
  // A reservation that covers no output at all cannot come from the lease. The least a reply can have is one token.
  return granted >= 1n ? Number(granted) : 1;
}
