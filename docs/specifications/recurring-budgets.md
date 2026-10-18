# Recurring budgets

Monthly, quarterly and yearly budgets that reset every period, with a Trends-style view of how each period went.

This is step 1 of a longer budgeting roadmap:

1. **Recurring periods** and a period-history view. One budget list instead of Category/Manual tabs. _(this spec)_
2. Manual include/exclude links on category budgets; merge the two detail pages.
3. Rule groups (categories AND/OR tags, accounts, payees) replacing `type`.
4. Pace and projection, an "all budgets this period" overview, threshold alerts, rollover.

## Model

Two new columns on `Budgets`:

| Column       | Type         | Notes                                                                                       |
| ------------ | ------------ | ------------------------------------------------------------------------------------------- |
| `recurrence` | `STRING(20)` | `none \| monthly \| quarterly \| yearly`, default `none`. Shared enum `BUDGET_RECURRENCES`. |
| `timezone`   | `STRING(64)` | IANA zone the periods are cut in (e.g. `Europe/Kyiv`). Nullable; null means UTC.            |

The existing columns change meaning only when `recurrence ≠ none`:

- **`startDate`** is required and marks the start of the first period. Its calendar day in `timezone` is the
  **anchor**: a monthly budget starting Oct 25 runs 25th → 24th; a yearly one starting Apr 1 is a fiscal year.
  It is stored as local midnight of that day.
- **`endDate`** is optional. Null means the budget repeats until archived. When set, it is snapped to the end of
  the period that contains it, so a series never ends on a half period.
- **`limitAmount`** is the limit **per period**.

No per-period rows are stored. Periods are computed from the anchor.

### Period arithmetic

For a step of `N` months (1, 3 or 12), period `k` starts at local midnight of `anchor + k·N months` and ends one
millisecond before period `k + 1` starts. Each start is computed from the anchor, not from the previous period, so
a day-31 anchor gives Jan 31, Feb 28/29, Mar 31 without drifting. Local wall-clock dates are converted to instants
with the user's IANA zone, which keeps boundaries on midnight across DST changes.

`resolveBudgetPeriod({ budget, at })` returns the period containing `at`, clamped to the series: before the
first period it returns period 0; after `endDate` it returns the last period.

## API

All existing budget reads keep their current behaviour for `recurrence = none`.

| Endpoint                                     | Change                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /budgets`, `PUT /budgets/:id`          | Accept `recurrence` and `timezone`. Validate `startDate` for recurring budgets; snap `endDate`.                                                                                                         |
| `GET /budgets/:id/stats?at=`                 | Recurring: totals for the period containing `at` (default now). Response gains `period`.                                                                                                                |
| `GET /budgets/:id/spending-stats?at=`        | Recurring: category breakdown and timeline for that period.                                                                                                                                             |
| `GET /budgets/:id/category-transactions?at=` | Recurring: only that period's transactions.                                                                                                                                                             |
| **`GET /budgets/:id/periods?at=&count=`**    | New. Totals for the last `count` periods (default 12, max 36) ending at the period containing `at`, plus cumulative running totals for that period and the previous one. 400 for non-recurring budgets. |

`period` on stats is `{ index, start, end }` or `null` for non-recurring budgets.

`/periods` response:

```ts
{
  recurrence: 'monthly' | 'quarterly' | 'yearly';
  periods: {
    index: number;
    periodStart: string; // ISO instant
    periodEnd: string;
    expense: number;     // decimal, refunds netted
    income: number;
    spent: number;       // max(0, expense - income), what the limit is compared against
    limitAmount: number | null;
    utilizationRate: number | null;
  }[];                   // oldest first, never before period 0
  cumulative: {
    granularity: 'day' | 'week' | 'month'; // day for monthly, week for quarterly, month for yearly
    current: CumulativeMonthData[];        // same shape the Trends CumulativeChart takes
    previous: CumulativeMonthData[];       // empty when the selected period is period 0
  };
}
```

All totals come from one pass over the budget's transactions for the whole range, bucketed in memory. They use the
same rules as `/stats`: matching split portions for category budgets, linked rows for manual budgets, refunds
netted, accounts excluded from stats skipped, planned rows only for the owner.

MCP tools `create-budget`, `update-budget`, `get-budgets` and `get-budget-spending-stats` gain the same fields.

## Frontend

### Budget list

- The Category/Manual tabs go away. One grid, sorted by the existing status priority.
- `category-budget-card` and `manual-budget-card` merge into one `budget-card`: category chips when the budget has
  categories, a transaction count otherwise, and a "Monthly / Quarterly / Yearly" badge for recurring budgets.
- Recurring cards show the **current period** (or the last one, labelled Ended, once the series has finished).

### Create and edit

A "Repeats" select (Doesn't repeat / Monthly / Quarterly / Yearly). For recurring budgets the date range becomes
"Starts on" plus an optional "Ends on"; the limit is labelled per period. The browser's IANA zone is sent as
`timezone`.

### Detail page (recurring budgets)

Built from the Trends Comparison parts:

| Trends part              | Budget use                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Period selector          | ‹ Oct 2026 › stepping through budget periods; sets `at` for every query.                                                      |
| Summary cards            | Spent vs limit, previous period, % change.                                                                                    |
| Monthly comparison chart | One bar per period with a dashed limit line; bars over the limit in the destructive colour; click a bar to select its period. |
| Cumulative chart         | This period vs previous, running total. Reused as is.                                                                         |
| Category breakdown       | Per-category spend this period vs previous (from `spending-stats?at=`).                                                       |

Non-recurring budgets keep the current detail page.

Two departures from the first draft of this plan:

- The period chart is a new component (`budget-period-chart.vue`) built from the same chart helpers as the
  Trends monthly chart (tooltip, axis formatting, the dashed reference line), not a split of that chart. Most of
  its 1,000 lines are stacked-category bars, legend hide/show and drill-through, none of which a budget needs,
  and threading them through props would put the Trends page at risk for no gain.
- The cumulative chart shows no limit line. `CumulativeChart` has no reference-line support; adding it is a
  small follow-up if the pace view wants it.

The stats cards, the utilization bar and the category budget's transaction list follow the selected period. The
manual budget's transaction list keeps showing every linked transaction: it is also where rows get unlinked, and it
already has a date filter.

## Out of scope for step 1

Per-period limit overrides, rollover, manual links on category budgets, tag rules, alerts.

## Open questions

- Should the history chart show periods before the first transaction? (Default: yes, from period 0, as zeroes.)
- Week start for quarterly cumulative steps follows the user's locale or Monday? (Default: Monday, matching
  `spending-stats`.)

## Step 2: hand overrides on category budgets

- **Link by hand.** `POST /budgets/:id/transactions` now works on category budgets too. A linked transaction the
  categories don't match counts whole; one they already match counts once, by its matching parts. Linking is
  idempotent, so the add dialog's "Select all" can include rows that are already linked.
- **Exclude.** `POST` / `DELETE /budgets/:id/excluded-transactions` take matched transactions out and put them back.
  Exclusions live in their own `BudgetExcludedTransactions` table, because every reader of `BudgetTransactions`
  treats a row as "in the budget". Excluding needs `manage` (it changes what the budget counts); linking keeps
  needing `write`. Excluding drops any hand link to the transaction, and linking clears an exclusion.
- **One definition of scope.** `collectBudgetEntries` is now the only place that decides what a budget counts;
  stats, the spending breakdown, period history and the category transaction list all read from it.
- **Split remainder fix.** A transaction with splits used to count only through its splits, so the part left on
  its own category was dropped ($100 groceries with $40 split off counted as $40 in a groceries budget). It now
  counts the remainder, as the global stats do.
- **One detail page.** `budget-info.vue` replaces the separate category and manual pages. Category budgets list
  each row's source ("Added by hand"), with exclude / remove actions and an "Excluded" section to restore from.

## Step 3: rules for automatic budgets

Automatic (`type: category`) budgets match by **rules** (`Budgets.rules`, JSONB, `BudgetRuleGroup[]`). A rule has
optional lists of categories, tags (with `tagMatch: any | all`), accounts and payees.

- Every condition that is filled in must hold for a rule to match; a transaction counts when **any** rule matches.
- A rule **with categories** counts only the matching parts of a split transaction (the remainder on the
  transaction's own category, and each matching split). A rule **without categories** (tags, account or payee only)
  counts the whole transaction. Parts matched by several rules count once.
- Tags, account and payee are checked on the transaction, so "category = Household and tag = Vacation" counts the
  Household split of a Vacation-tagged purchase.
- On save, ids are checked against the owner's data, parent categories are expanded to their children, and empty
  rules are dropped. `BudgetCategories` is kept equal to the categories the rules name, for chips, export and
  category-delete cleanup; matching reads `rules`.
- Existing category budgets were migrated to one categories-only rule. A plain `categoryIds` on create still means
  one rule; on edit it replaces the categories of a single-rule budget and is rejected for multi-rule budgets.
- The matching runs as one candidate query (the OR of the rules, with subqueries for split categories and tags),
  then `matchRuleGroups` settles `tagMatch: all` and which parts count on the loaded rows.
- Backup restore remaps the ids inside `rules`. MCP `create_budget` / `update_budget` accept `rules`.
- The create and edit forms have a rule editor; the detail page shows the rules as "in Food and tagged #vacation",
  with "or" between rules. Category budgets are now labelled "Automatic".

## Step 4: pace, overview, alerts and rollover

- **Rollover** (`Budgets.rollover`: `none | surplus | all`, recurring budgets with a limit). Each period's limit is
  the base limit plus what the previous period carried: with `surplus` only unspent limit carries; with `all`
  overspending carries too, so a period can start below the base limit. Limits depend on every earlier period, so
  with rollover on, spending is collected from the first period. `/stats` returns the period's `limitAmount` and
  `rolledOverAmount`; `/periods` returns each period's own limit, and the chart marks the limit per bar when they
  differ.
- **Alerts.** An hourly cron (`budget-alerts-check`, :20 UTC, production only) notifies the owner when spending
  reaches 80% and then 100% of the limit: the current period for recurring budgets, the date range for one-off ones.
  Each threshold fires once per period (tracked in `Budgets.alertState`); jumping past both sends only the 100% one.
  It honours the existing "budget alerts" notification setting and skips archived, ended and limitless budgets.
  Notifications reuse the existing `budget_alert` type, which already links to the budget.
- **Pace** (current period only): spending against an even pace through the period, the projected total at the
  current rate, and what's left per remaining day.
- **This period overview** on the budget list: spent against limits per cadence (monthly, quarterly and yearly are
  never added together), with how many budgets are over.

## Known gaps

- The CSV data export has no recurrence, rules or rollover columns.
- `CumulativeChart` shows no limit line.
- Matching rule ids that point at deleted tags, accounts or payees are kept in `rules` and simply match nothing.
