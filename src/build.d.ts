/**
 * The build's own identity, replaced at compile time — see `buildId` in `vite.config.ts`.
 *
 * Declared rather than imported because it is not a module: Vite substitutes the literal wherever this
 * name appears, so a stray reference in a test file would be a compile error rather than a runtime one.
 */
declare const __BUILD__: string
