<script setup lang="ts">
import { usePayeesByIds } from '@/composable/data-queries/payees';
import { useAccountsStore, useCategoriesStore, useTagsStore } from '@/stores';
import type { BudgetRuleGroup } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

interface Chip {
  key: string;
  label: string;
  color?: string;
}

const props = defineProps<{
  rules: BudgetRuleGroup[];
}>();

const { categoriesMap } = storeToRefs(useCategoriesStore());
const { accountsRecord } = storeToRefs(useAccountsStore());
const tagsStore = useTagsStore();
const { isFetched: areTagsFetched, isLoading: areTagsLoading } = storeToRefs(tagsStore);
if (!areTagsFetched.value && !areTagsLoading.value) tagsStore.loadTags();

const payeeIds = computed(() => [...new Set(props.rules.flatMap((rule) => rule.payeeIds))]);
const { byId: payeesById } = usePayeesByIds({ ids: payeeIds });

/**
 * Rules store parent categories expanded with their children; show only the top-most
 * selected ones so "Food" doesn't read as "Food, Groceries, Restaurants, …".
 */
const topCategoryIds = ({ rule }: { rule: BudgetRuleGroup }) => {
  const selected = new Set<string>(rule.categoryIds);
  return rule.categoryIds.filter((id) => {
    const parentId = categoriesMap.value[id]?.parentId;
    return !parentId || !selected.has(parentId);
  });
};

const ruleChips = computed(() =>
  props.rules.map((rule) => {
    const groups: { kind: string; chips: Chip[]; joiner?: string }[] = [];

    const categories = topCategoryIds({ rule }).map((id) => ({
      key: `c-${id}`,
      label: categoriesMap.value[id]?.name ?? '…',
      color: categoriesMap.value[id]?.color,
    }));
    if (categories.length) groups.push({ kind: 'categories', chips: categories });

    const tags = rule.tagIds.map((id) => ({
      key: `t-${id}`,
      label: `#${tagsStore.getTagById(id)?.name ?? '…'}`,
      color: tagsStore.getTagById(id)?.color,
    }));
    if (tags.length) groups.push({ kind: 'tags', chips: tags, joiner: rule.tagMatch });

    const accounts = rule.accountIds.map((id) => ({ key: `a-${id}`, label: accountsRecord.value[id]?.name ?? '…' }));
    if (accounts.length) groups.push({ kind: 'accounts', chips: accounts });

    const payees = rule.payeeIds.map((id) => ({ key: `p-${id}`, label: payeesById.value.get(id)?.name ?? '…' }));
    if (payees.length) groups.push({ kind: 'payees', chips: payees });

    return groups;
  }),
);
</script>

<template>
  <div class="grid gap-2">
    <template v-for="(groups, ruleIndex) in ruleChips" :key="ruleIndex">
      <div v-if="ruleIndex > 0" class="text-muted-foreground text-xs font-medium uppercase">
        {{ $t('budgets.rules.or') }}
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <template v-for="(group, groupIndex) in groups" :key="group.kind">
          <span v-if="groupIndex > 0" class="text-muted-foreground px-0.5 text-xs">{{ $t('budgets.rules.and') }}</span>
          <span class="text-muted-foreground text-xs">{{ $t(`budgets.rules.summary.${group.kind}`) }}</span>
          <span
            v-for="chip in group.chips"
            :key="chip.key"
            class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            :class="chip.color ? 'text-white' : 'bg-muted text-foreground'"
            :style="chip.color ? { backgroundColor: chip.color } : undefined"
          >
            {{ chip.label }}
          </span>
          <span v-if="group.joiner === 'all' && group.chips.length > 1" class="text-muted-foreground text-xs">
            ({{ $t('budgets.rules.tagMatchAll') }})
          </span>
        </template>
      </div>
    </template>
  </div>
</template>
