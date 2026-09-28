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
