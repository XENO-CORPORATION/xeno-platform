/**
 * `@xenosystem/elements` — the XENO element contract.
 *
 * The source of truth every renderer interprets. Zero dependencies, zero framework, zero
 * platform: this package is a contract, not a component library.
 *
 * NOTE ON BARRELS: this index re-exports the *schema* (types and one pure function), which is
 * small and tree-shakes cleanly. Element DECLARATIONS must never be barrelled — a single index
 * importing every element is exactly why `lucide-react` weighs 2.4 MB. Declarations get
 * per-element entry points when they land.
 *
 * @module
 */

export * from './schema'
