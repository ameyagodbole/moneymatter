# Stock Splits

How holdings stay correct when a security splits.

> **TL;DR**
> A split is stored once per security in `SecuritySplits`, fetched from Yahoo during price syncs. Transactions keep the quantities the broker recorded. Everywhere share counts are rebuilt from transactions, each quantity is first converted to **today's share basis** by multiplying it by every split that happened after the trade. Cost basis and cash never change.

Terms used throughout: **ratio** is new shares per old share (`numerator / denominator`; a 3-for-1 split is 3, a 1-for-10 reverse split is 0.1). **Share basis** is the unit a quantity is counted in: shares before a split and shares after it are different units. **Today's share basis** is the unit after every split recorded so far.

## 1. The Problem

A split multiplies the shares held without any trade. Broker exports usually don't record it: M1's activity export, for example, lists Tesla purchases in 2021 in pre-split shares and the 2026 sale in post-split shares, with nothing in between. Without split support:

- The holding shows the pre-split share count. After Tesla's 3-for-1 split, 0.08124 shares bought in 2021 are really 0.24372.
- The value is wrong by the split ratio: 0.08124 shares × today's price.
- A later sale of the real share count is rejected as selling more than owned, so a closed position stays open and keeps its cost basis.

## 2. Decisions

### 2.1 A split is a fact about the security, not a transaction

Splits live in `SecuritySplits` (`securityId`, `date`, `numerator`, `denominator`, `source`), unique per security and date.

- **Why:** a split happens to the security. Every holder is affected identically, on the same date, by the same ratio. Per-holding split transactions would have to be created for every holding, and recreated whenever someone backdates a trade across a split date.
- **Trade-off:** there is no per-holding opt-out. A user who already corrected a split by hand (for example with a $0 buy of the extra shares) must delete that correction, or the split counts twice.

### 2.2 Transactions stay as recorded; quantities are converted where they are read

A transaction keeps the quantity and price the broker reported. Code that rebuilds share counts converts each quantity with `toCurrentShareBasis` before using it:

```
quantity in today's basis = recorded quantity × product of ratios of splits dated after the trade
```

This happens in:

- **holding recalculation**: the stored share count and cost basis
- **the sell check** when creating or updating a transaction
- **the combined balance history** replay
- **annualized returns** (time-weighted return)
- **realized gains** (FIFO lot matching): prices are divided by the same factor, so a lot's cost doesn't change
- **the net-worth breakdown**'s holdings snapshots

- **Why here and not at write time:** splits can arrive after the trades (a backfill, or a split announced later). Converting on read means a newly fetched split corrects every holding and every chart without rewriting transactions. The history users see is also what their broker reported.
- **Ex-date rule:** a trade dated **on** the split date is already in post-split shares, so only splits dated strictly after the trade apply. This matches how exchanges quote a stock from its ex-date.

### 2.3 Why today's basis, not the basis of each date

Stored historical prices are split-adjusted. Yahoo's chart closes and Polygon's default aggregates restate every past price in today's share basis. A share count in today's basis × a split-adjusted price gives the real value on every past date. Converting quantities to each date's own basis would need unadjusted prices, which the providers don't return.

**Caveat:** the Alpha Vantage fallback's daily series and user-uploaded prices may be unadjusted. History valued from those prices stays wrong across a split. Current value is unaffected, because after the latest split both bases agree.

### 2.4 Cost basis, cash and returns don't move

A split changes neither money invested nor cash: the cost per share falls by the ratio, and the total cost stays the same. `computeHoldingTotals` needs no split case, because it sums amounts, and amounts don't change. Splits are not contributions and create no cash flow in returns.

### 2.5 Source: Yahoo, fetched during price syncs

`syncSecuritySplits` asks Yahoo's chart endpoint for split events over the full history, at a monthly interval so only a small payload comes back. It covers the same stock securities as the price sync (holdings not excluded from syncing, in portfolios that aren't deleted):

- at the end of each daily price sync, and each manual one (the **Sync prices** button)
- after a new security's historical price sync
- when a CSV import creates a security, before its trades are inserted: the sell check needs the splits, and the historical price sync only starts after the import

It upserts provider rows and recalculates every holding of a security whose splits changed. A failed lookup is logged and retried on the next sync: split lookups never fail the price sync that runs them.

- **Crypto** is skipped: tokens don't split. Redenominations are out of scope.
- **If Yahoo is disabled** (no Yahoo provider), no splits are fetched. Existing rows keep applying.
- **Existing installs** backfill on the first sync after upgrading. No migration-time network calls.

### 2.6 Splits are visible in the activity list

The portfolio's **All activity** tab lists a split of a held security as its own row ("SPLIT TSLA 3:1"). It moves no cash, so a reconciliation against the broker shows why the share count jumped.

## 3. Not in Scope (follow-ups)

- **Manual split entry** (API or UI) for securities Yahoo doesn't cover. `source` already distinguishes `provider` from `manual` rows so this can be added without a schema change.
- **Importing split rows.** Some brokers export splits as rows, or restate old trades in post-split shares. Importing those as well would count the split twice; the importer would need a split row type that records the event instead of a trade.
- **Cash in lieu** on reverse splits. The fractional share a broker cashes out is a sale and should be recorded as one.
- **Dividend-adjusted prices.** The Yahoo provider stores `adjclose`, which is also adjusted for dividends. Since dividends are recorded as cash, this understates historical prices and counts dividends twice in returns. It's separate from splits and needs its own decision (store `close`, which is split-adjusted only).
- **Hosted service.** `SecuritySplits` is shared by every user of a security, which is correct for provider data. Manual entry there would need admin control.
