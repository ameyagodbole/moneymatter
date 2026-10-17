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
