<template>
  <div>
    <div class="mb-4 flex items-center gap-2">
      <InputField v-model="searchQuery" :placeholder="$t('payees.searchPlaceholder')" class="flex-1">
        <template #iconLeading>
          <SearchIcon class="text-muted-foreground size-4" />
        </template>
      </InputField>
      <UiButton variant="outline" size="sm" class="shrink-0 gap-1.5" @click="openCreateDialog">
        <PlusIcon class="size-4" />
        {{ $t('payees.newPayeeButton') }}
      </UiButton>
    </div>

    <div
      v-if="selectedPayees.length > 0"
      class="bg-muted/40 mb-2 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <span class="font-medium">{{ $t('payees.bulkMerge.selectedCount', { count: selectedPayees.length }) }}</span>
      <span v-if="selectedPayees.length > MAX_MERGE_SELECTION" class="text-muted-foreground text-xs">
        {{ $t('payees.bulkMerge.tooMany', { max: MAX_MERGE_SELECTION }) }}
      </span>
      <div class="ml-auto flex items-center gap-2">
        <UiButton variant="ghost" size="sm" @click="clearSelection">
          {{ $t('payees.bulkMerge.clearSelection') }}
        </UiButton>
        <UiButton size="sm" :disabled="!canMerge" @click="isMergeOpen = true">
          <GitMergeIcon class="size-4" />
          {{ $t('payees.bulkMerge.mergeButton') }}
        </UiButton>
      </div>
    </div>

    <PayeesTable v-model:selected="selectedPayees" :search-query="debouncedQuery" />

    <MergePayeesDialog v-model:open="isMergeOpen" :payees="selectedPayees" @merged="clearSelection" />

    <PayeeFormDialog v-model:open="dialogState.isOpen" :payee="dialogState.payee" />
  </div>
</template>

<script setup lang="ts">
import { Button as UiButton } from '@/components/lib/ui/button';
import InputField from '@/components/fields/input-field.vue';
import type { PayeeWithStats } from '@/api/payees';
import { GitMergeIcon, PlusIcon, SearchIcon } from '@lucide/vue';
import { useDebounce, useSessionStorage } from '@vueuse/core';
import { computed, reactive, ref } from 'vue';

import MergePayeesDialog from './merge-payees-dialog.vue';
import PayeeFormDialog from './payee-form-dialog.vue';
import PayeesTable from './payees-table.vue';

const DEBOUNCE_MS = 200;
// One survivor plus the backend's cap of 100 source Payees per merge.
const MAX_MERGE_SELECTION = 101;

const searchQuery = useSessionStorage('payees-search-query', '');
const searchQueryDebounced = useDebounce(searchQuery, DEBOUNCE_MS);
const debouncedQuery = computed(() => (searchQueryDebounced.value ?? '').trim());

const dialogState = reactive<{ isOpen: boolean; payee: null }>({
  isOpen: false,
  payee: null,
});
const openCreateDialog = () => {
  dialogState.payee = null;
  dialogState.isOpen = true;
};

const selectedPayees = ref<PayeeWithStats[]>([]);
const isMergeOpen = ref(false);
const canMerge = computed(() => selectedPayees.value.length >= 2 && selectedPayees.value.length <= MAX_MERGE_SELECTION);
const clearSelection = () => {
  selectedPayees.value = [];
};
</script>
