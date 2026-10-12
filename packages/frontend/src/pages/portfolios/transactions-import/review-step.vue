<script setup lang="ts">
import { checkInvestmentImportDuplicates, executeInvestmentImport } from '@/api/investment-transactions-import';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useAllCurrencies } from '@/composable/data-queries/currencies';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import type {
  InvestmentImportCashTransaction,
  InvestmentImportHolding,
  InvestmentImportTransaction,
} from '@bt/shared/types/investments';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { CircleDollarSignIcon, CoinsIcon, InfoIcon, Loader2Icon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import CashTransactionsCard from './cash-transactions-card.vue';
import HoldingCard from './holding-card.vue';

const TOOLTIP_CLASS = 'max-w-xs';

const props = defineProps<{
  portfolioId: string;
  initialHoldings: InvestmentImportHolding[];
  initialCashTransactions: InvestmentImportCashTransaction[];
  initialWarnings: string[];
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'imported'): void;
}>();

const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const queryClient = useQueryClient();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const holdings = ref<InvestmentImportHolding[]>(
  props.initialHoldings.map((h) => ({ ...h, transactions: h.transactions.map((tx) => ({ ...tx })) })),
);
const cashTransactions = ref<InvestmentImportCashTransaction[]>([...props.initialCashTransactions]);
const warnings = ref<string[]>([...props.initialWarnings]);
// Possible duplicates start out skipped; the user has to opt in to import them.
const skipTempIds = ref<Set<string>>(
  new Set(
    [...holdings.value.flatMap((h) => h.transactions), ...cashTransactions.value]
      .filter((tx) => tx.possibleDuplicateOf)
      .map((tx) => tx.tempId),
  ),
);
const expandedHoldings = ref<Set<string>>(new Set());
// Holdings with a duplicate re-check in flight; commit waits for them so a
// late flag can't let a duplicate through.
const recheckingHoldings = ref<Set<string>>(new Set());

const { data: allCurrencies } = useAllCurrencies();

const currencyOptions = computed(() => {
  const list = allCurrencies.value ?? [];
  return list.map((c) => ({ value: c.code, label: c.code }));
});

type TransactionSide = InvestmentImportTransaction['side'];
const sideOptions = computed<Array<{ value: TransactionSide; label: string }>>(() => [
  { value: 'buy', label: t('investmentsImport.review.buy') },
  { value: 'sell', label: t('investmentsImport.review.sell') },
  { value: 'dividend', label: t('investmentsImport.categories.dividend') },
  { value: 'fee', label: t('investmentsImport.categories.fee') },
  { value: 'tax', label: t('investmentsImport.categories.tax') },
]);

function blockedProviderSymbolsForHolding(currentTempId: string): string[] {
  return holdings.value
    .filter((h) => h.tempId !== currentTempId && h.resolvedSecurity)
    .map((h) => h.resolvedSecurity!.providerSymbol);
}

function isTransactionValid(tx: InvestmentImportTransaction): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) return false;
  const qty = Number(tx.quantity);
  const price = Number(tx.price);
  const fees = Number(tx.fees);
  if (!Number.isFinite(qty) || qty <= 0) return false;
  // Zero price is legitimate for staking rewards, airdrops, balance adjustments,
  // burns/lost-token writeoffs — they are real position changes with no cash
  // consideration. The source's BUY/SELL classification is authoritative.
  if (!Number.isFinite(price) || price < 0) return false;
  if (!Number.isFinite(fees) || fees < 0) return false;
  return sideOptions.value.some((option) => option.value === tx.side);
}

function isHoldingValid(h: InvestmentImportHolding): boolean {
  if (!h.resolvedSecurity) return false;
  if (!h.currencyCode) return false;
  if (!h.portfolioId) return false;
  if (h.transactions.length === 0) return false;
  return h.transactions.every(isTransactionValid);
}

const duplicateSecurityRows = computed(() => {
  const counts = new Map<string, string[]>();
  for (const h of holdings.value) {
    const key = h.resolvedSecurity?.providerSymbol;
    if (!key) continue;
    const list = counts.get(key);
    if (list) list.push(h.tempId);
    else counts.set(key, [h.tempId]);
  }
  const offending = new Set<string>();
  for (const list of counts.values()) {
    if (list.length > 1) for (const id of list) offending.add(id);
  }
  return offending;
});

const allValid = computed(
  () =>
    holdings.value.length + cashTransactions.value.length > 0 &&
    holdings.value.every(isHoldingValid) &&
    duplicateSecurityRows.value.size === 0 &&
    recheckingHoldings.value.size === 0,
);

function computeAmount(tx: InvestmentImportTransaction): string {
  const qty = Number(tx.quantity || '0');
  const price = Number(tx.price || '0');
  const fees = Number(tx.fees || '0');
  if (!Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(fees)) return '0';
  return (qty * price + fees).toFixed(10);
}

watch(
  holdings,
  (list) => {
    for (const h of list) {
      for (const tx of h.transactions) tx.amount = computeAmount(tx);
    }
  },
  { deep: true },
);

function deleteHolding(tempId: string) {
  holdings.value = holdings.value.filter((h) => h.tempId !== tempId);
}

function deleteTransaction(holdingTempId: string, txTempId: string) {
  const holding = holdings.value.find((h) => h.tempId === holdingTempId);
  if (!holding) return;
  holding.transactions = holding.transactions.filter((tx) => tx.tempId !== txTempId);
  if (holding.transactions.length === 0) deleteHolding(holdingTempId);
}

function deleteCashTransaction(tempId: string) {
  cashTransactions.value = cashTransactions.value.filter((cashTx) => cashTx.tempId !== tempId);
}

function toggleSkipDuplicate(tempId: string) {
  const next = new Set(skipTempIds.value);
  if (next.has(tempId)) next.delete(tempId);
  else next.add(tempId);
  skipTempIds.value = next;
}

function setRechecking(tempId: string, active: boolean) {
  const next = new Set(recheckingHoldings.value);
  if (active) next.add(tempId);
  else next.delete(tempId);
  recheckingHoldings.value = next;
}

/**
 * Identity of the security a holding points at. Search picks always carry
 * `securityId: null`, so the id alone can't tell one pick from another.
 */
function securityKey(holding: InvestmentImportHolding): string | null {
  const security = holding.resolvedSecurity;
  if (!security) return null;
  return [
    security.securityId,
    security.assetClass,
    security.providerName,
    security.providerSymbol,
    security.currencyCode,
  ].join('|');
}

/**
 * Re-run the duplicate check for one holding against its current security.
 * Old flags belonged to the previous security, so they're cleared first; new
 * flags start out skipped, same as the ones from extract.
 */
async function recheckDuplicates(holding: InvestmentImportHolding) {
  const key = securityKey(holding);
  const security = holding.resolvedSecurity;
  const nextSkips = new Set(skipTempIds.value);
  for (const tx of holding.transactions) {
    tx.possibleDuplicateOf = null;
    nextSkips.delete(tx.tempId);
  }
  skipTempIds.value = nextSkips;

  setRechecking(holding.tempId, Boolean(security));
  if (!security) return;

  try {
    const { duplicates } = await checkInvestmentImportDuplicates({
      portfolioId: holding.portfolioId,
      security: {
        securityId: security.securityId,
        assetClass: security.assetClass,
        providerName: security.providerName,
        providerSymbol: security.providerSymbol,
        symbol: security.symbol,
        currencyCode: security.currencyCode,
      },
      transactions: holding.transactions.map(({ tempId, date, side, price, amount }) => ({
        tempId,
        date,
        side,
        price,
        amount,
      })),
    });
    // The user picked yet another security while this was in flight.
    if (securityKey(holding) !== key) return;

    const byTempId = new Map(duplicates.map((d) => [d.tempId, d.existingTransactionId]));
    const withNewSkips = new Set(skipTempIds.value);
    for (const tx of holding.transactions) {
      const match = byTempId.get(tx.tempId);
      if (!match) continue;
      tx.possibleDuplicateOf = match;
      withNewSkips.add(tx.tempId);
    }
    skipTempIds.value = withNewSkips;
  } catch {
    warnings.value = [
      ...warnings.value,
      t('investmentsImport.review.duplicateRecheckFailed', { symbol: holding.parsedSymbol }),
    ];
  } finally {
    if (securityKey(holding) === key) setRechecking(holding.tempId, false);
  }
}

// Security last checked per holding; extract already checked the initial ones.
const checkedSecurityKeys = new Map(holdings.value.map((h) => [h.tempId, securityKey(h)]));

watch(
  () => holdings.value.map(securityKey),
  () => {
    for (const holding of holdings.value) {
      const key = securityKey(holding);
      if (checkedSecurityKeys.get(holding.tempId) === key) continue;
      checkedSecurityKeys.set(holding.tempId, key);
      recheckDuplicates(holding);
    }
  },
);

function toggleHoldingExpansion(tempId: string) {
  const next = new Set(expandedHoldings.value);
  if (next.has(tempId)) next.delete(tempId);
  else next.add(tempId);
  expandedHoldings.value = next;
}

function skippedDuplicateCount(h: InvestmentImportHolding): number {
  return h.transactions.filter((tx) => tx.possibleDuplicateOf && skipTempIds.value.has(tx.tempId)).length;
}

function unskippedDuplicateCount(h: InvestmentImportHolding): number {
  let count = 0;
  for (const tx of h.transactions) {
    if (tx.possibleDuplicateOf && !skipTempIds.value.has(tx.tempId)) count += 1;
  }
  return count;
}

const execute = useMutation({
  mutationFn: () =>
    executeInvestmentImport({
      holdings: holdings.value,
      cashTransactions: cashTransactions.value,
      skipTempIds: Array.from(skipTempIds.value),
    }),
  onSuccess: (result) => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.holdingsList });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioInvestmentTransactions });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioSummary });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioBalances });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioTransfers });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioActivity });
    addNotification({
      text: t('investmentsImport.notifications.imported', {
        count: result.createdTransactions + result.createdCashTransactions,
      }),
      type: NotificationType.success,
    });

    // Surface the partial-import counters and warnings the backend already
    // builds. Without this the toast says "Imported N transactions" while
    // silently dropping N skippedHoldings / failedTransactions / warning
    // strings, leaving the user to wonder why their import shrank.
    const hadIssues = result.skippedHoldings > 0 || result.failedTransactions > 0 || (result.warnings?.length ?? 0) > 0;
    if (hadIssues) {
      const lines: string[] = [];
      if (result.skippedHoldings > 0) {
        lines.push(t('investmentsImport.notifications.skippedHoldings', { count: result.skippedHoldings }));
      }
      if (result.failedTransactions > 0) {
        lines.push(t('investmentsImport.notifications.failedTransactions', { count: result.failedTransactions }));
      }
      if (result.warnings && result.warnings.length > 0) lines.push(...result.warnings);
      addNotification({
        text: lines.join('\n'),
        type: NotificationType.warning,
      });
    }

    emit('imported');
  },
  onError: (err: Error) => {
    addNotification({
      text: err.message || t('investmentsImport.notifications.importFailed'),
      type: NotificationType.error,
    });
  },
});
</script>

<template>
  <div class="space-y-4">
    <Callout v-if="warnings.length > 0" :title="$t('investmentsImport.review.warningsTitle')">
      <ul class="list-inside list-disc space-y-0.5">
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
    </Callout>

    <div
      v-if="holdings.length === 0 && cashTransactions.length === 0"
      class="text-muted-foreground py-10 text-center text-sm"
    >
      {{ $t('investmentsImport.review.empty') }}
    </div>

    <template v-if="holdings.length > 0">
      <div
        class="text-muted-foreground hidden gap-3 px-4 text-xs font-medium tracking-wider uppercase @md/import:grid @md/import:grid-cols-[1fr_160px_140px_180px]"
      >
        <div class="flex items-center gap-1.5">
          <CoinsIcon class="size-3.5" />
          {{ $t('investmentsImport.review.cols.security') }}
          <DesktopOnlyTooltip
            :content="$t('investmentsImport.review.tooltips.security')"
            :content-class-name="TOOLTIP_CLASS"
          >
            <InfoIcon class="size-3.5" />
          </DesktopOnlyTooltip>
        </div>
        <div class="flex items-center gap-1.5">
          <CircleDollarSignIcon class="size-3.5" />
          {{ $t('investmentsImport.review.cols.currency') }}
          <DesktopOnlyTooltip
            :content="$t('investmentsImport.review.tooltips.currency')"
            :content-class-name="TOOLTIP_CLASS"
          >
            <InfoIcon class="size-3.5" />
          </DesktopOnlyTooltip>
        </div>
        <div class="text-right">{{ $t('investmentsImport.review.cols.txCount') }}</div>
        <div></div>
      </div>

      <HoldingCard
        v-for="holding in holdings"
        :key="holding.tempId"
        :holding="holding"
        :blocked-provider-symbols="blockedProviderSymbolsForHolding(holding.tempId)"
        :currency-options="currencyOptions"
        :side-options="sideOptions"
        :skip-temp-ids="skipTempIds"
        :expanded="expandedHoldings.has(holding.tempId)"
        :compact="isMobile"
        :is-duplicate-security="duplicateSecurityRows.has(holding.tempId)"
        :is-valid="isHoldingValid(holding)"
        :unskipped-duplicate-count="unskippedDuplicateCount(holding)"
        :skipped-duplicate-count="skippedDuplicateCount(holding)"
        :is-transaction-valid="isTransactionValid"
        @delete="deleteHolding(holding.tempId)"
        @toggle-expansion="toggleHoldingExpansion(holding.tempId)"
        @toggle-skip-transaction="toggleSkipDuplicate"
        @delete-transaction="(txTempId) => deleteTransaction(holding.tempId, txTempId)"
      />
    </template>

    <CashTransactionsCard
      v-if="cashTransactions.length > 0"
      :cash-transactions="cashTransactions"
      :skip-temp-ids="skipTempIds"
      @toggle-skip="toggleSkipDuplicate"
      @delete="deleteCashTransaction"
    />

    <div class="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
      <Button variant="outline" @click="emit('back')">{{ $t('investmentsImport.review.back') }}</Button>
      <Button :disabled="!allValid || execute.isPending.value" @click="execute.mutate()">
        <Loader2Icon v-if="execute.isPending.value" class="mr-1 size-4 animate-spin" />
        {{ $t('investmentsImport.review.commit') }}
      </Button>
    </div>
  </div>
</template>
