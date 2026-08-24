/**
 * Types for the plain-JS handoff module.
 *
 * It stays .js because the SERVER imports the same file (src/server/lib/
 * onboardingHandoff.js mirrors it, and both are gated to stay in step). The
 * server runs untranspiled, so the shared rule cannot be written in TS —
 * hence a hand-written declaration rather than a rename.
 */
export const AUTH_TOKEN_KEY: string;
export const ONBOARDING_PATH: string;
export const ONBOARDING_DONE_KEY: string;
export const ONBOARDING_NEXT_KEY: string;
export const RETURN_URL_KEY: string;

export function resolveOAuthLandingPath(returnUrl: string | null | undefined, isNew: boolean): string;
// Type predicate, not plain boolean: the implementation rejects anything
// non-string, so narrowing here is accurate AND lets a caller pass the
// result of URLSearchParams.get() straight into sessionStorage.setItem.
export function isAllowedOnboardingNext(next: string | null | undefined): next is string;
export function consumeOnboardingNext(): string | null;
export function destinationAfterOnboarding(fallback?: string): string;
export function isExternalOnboardingNext(next: string | null | undefined): boolean;
export function isStashableReturnUrl(raw: string | null | undefined): boolean;
export function isPrivilegedReturnUrl(raw: string | null | undefined): boolean;
export function stashReturnUrl(raw: string | null | undefined): void;
export function peekReturnUrl(): string | null;
export function consumeReturnUrl(): string | null;
export function resolveActivationContinue(pending: string | null | undefined): string;
export function destinationAfterActivation(): string;
export function isFullPageActivationDest(dest: string | null | undefined): boolean;
