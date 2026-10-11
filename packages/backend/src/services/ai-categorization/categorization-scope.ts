/**
 * Which rows a categorization run may touch. The entry points want different sets:
 *
 * - `userRetry` — the candidates screen and the manual trigger. "Waiting for
 *   categorization" means still sitting in the default category, and every row the user
 *   sees in that list is there by construction. That includes rows an earlier run skipped:
 *   they are still uncategorized, and a user asking for a run is asking to spend tokens.
 * - `defaultCategoryOnly` — CSV and OFX imports: new rows left in the default category.
 * - `anyCategory` — the sync and statement import auto-path. A `hint`-mode Payee rule fills
 *   a real category and leaves `categorizationMeta` null precisely so the AI may still
 *   override it, which a default-category filter would make impossible.
 *
 * Only `userRetry` reaches rows an earlier run skipped. The automatic runs leave them alone,
 * so a sync never pays again for rows the model already declined.
 *
 * Kept free of model imports so the queue and the listeners can carry it without pulling
 * the Sequelize graph into their unit tests.
 */
export const CATEGORIZATION_SCOPE = {
  userRetry: 'user-retry',
  defaultCategoryOnly: 'default-category-only',
  anyCategory: 'any-category',
} as const;

export type CategorizationScope = (typeof CATEGORIZATION_SCOPE)[keyof typeof CATEGORIZATION_SCOPE];
