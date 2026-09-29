# Potential features

Ideas that aren't scheduled yet. Each entry says what it is, why it's useful, and what building it would involve.

## Payees

### Suggested duplicate payees

**What:** A "Possible duplicates" section on the payees page that groups payees which look like the same merchant, such as `AMZN Mktp`, `Amazon.com` and `Amazon`. Each group has a button that opens the bulk merge dialog with the group preselected.

**Why:** Auto-creation can produce many near-duplicates. Bulk merge makes cleanup possible, but the user still has to find every duplicate by searching.

**How:**

- Build a Fuse index over every payee name and alias with `buildFuzzyIndex` (`packages/backend/src/services/payees/fuzzy-matcher.ts`). Search each payee against it and group any payees that match below `FUZZY_MATCH_THRESHOLD`. Payees with the same normalized name once store numbers are stripped are the strongest candidates.
- Add a read-only endpoint (for example `GET /payees/duplicate-suggestions`) that returns the groups.
- Add a "Not duplicates" action that saves the rejected pair in a new table, so the group isn't suggested again.
- Merging a group uses the existing `POST /payees/merge`.

### Tell auto-created payees apart from manual ones

**What:** Record how each payee was created (auto-created during import or sync, or created by the user) and show it in the payees table, with a filter.

**Why:** Makes it easy to review only what the app created by itself, and lets duplicate suggestions look at auto-created payees first.

**How:**

- Add a column to `Payees` recording how each payee was created (auto vs. manual). The field that already holds `'auto'` on the model records where the logo came from, not how the payee was created, so it can't be reused.
- Set the new column in the auto-creation path and in `createPayee`. Existing payees stay unknown (`null`); it can't be recovered for them.
- Add a filter to `GET /payees` and a badge or filter chip in the table.

### Merge from the transactions list

**What:** When the user selects transactions and sets their payee to X, offer to merge any payee left with no transactions into X.

**Why:** Fits users who clean up from the transactions view rather than the payees page.

**How:** After a bulk payee update on transactions, find the previous payees that now have no transactions and offer a one-click merge into X, using `POST /payees/merge`.

## Investments

### Record imported trades at the broker's cash amount

**What:** When an investment CSV import maps the **Amount** column, record each buy and sell at a price of |Amount| ÷ units instead of the file's unit price.

**Why:** Brokers round the units and the unit price they export (M1 uses 5 decimals for units and cents for the price), so units × price drifts from what was actually charged or paid. Over an M1 history of 218 trades this left the portfolio's cash $0.18 above the broker's and the cost basis 2¢ off. Cash and cost basis should match the statement to the cent.

**How:**

- In `csv-parser.service.ts` (`packages/backend/src/services/import-export/investment-transactions-parser/`), for buy and sell rows with a non-zero quantity and an amount, set the price to |amount| ÷ |quantity|. Amount-only dividends already use the amount.
- The stored price then differs from the broker's in the 4th decimal or so, and fees must stay 0 for these rows or they'd be counted twice (the broker's amount already includes them). Decide whether to keep the file's unit price for display.
- Duplicate detection compares prices, so re-importing a file imported before this change would stop flagging its trades. Compare amounts instead, or allow a small price tolerance.
