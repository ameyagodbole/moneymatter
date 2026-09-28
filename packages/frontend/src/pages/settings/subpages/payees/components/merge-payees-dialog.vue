<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('payees.bulkMerge.title', { count: payees.length }) }}</template>
    <template #description>{{ $t('payees.bulkMerge.description') }}</template>

    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <Label class="text-sm font-medium">{{ $t('payees.bulkMerge.keepLabel') }}</Label>
        <RadioGroup v-model="targetId" class="flex flex-col gap-1">
          <div v-for="payee in payees" :key="payee.id" class="flex items-center gap-2 py-1">
            <RadioGroupItem :id="`merge-target-${payee.id}`" :value="payee.id" />
            <Label :for="`merge-target-${payee.id}`" class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <span class="truncate font-normal">{{ payee.name }}</span>
              <span class="text-muted-foreground ml-auto shrink-0 text-xs font-normal tabular-nums">
                {{
                  $t('payees.bulkMerge.transactionCount', {
                    count: transactionCount(payee),
                  })
                }}
              </span>
            </Label>
          </div>
        </RadioGroup>
      </div>

      <div v-if="categoryIds.length > 0" class="flex flex-col gap-2">
        <Label class="text-sm font-medium">{{ $t('payees.bulkMerge.categoryLabel') }}</Label>
        <RadioGroup v-model="categoryChoice" class="flex flex-col gap-1">
          <div v-for="categoryId in categoryIds" :key="categoryId" class="flex items-center gap-2 py-1">
            <RadioGroupItem :id="`merge-category-${categoryId}`" :value="categoryId" />
            <Label :for="`merge-category-${categoryId}`" class="min-w-0 cursor-pointer font-normal">
              <CategoryDisplay :category-id="categoryId" />
            </Label>
          </div>
          <div class="flex items-center gap-2 py-1">
            <RadioGroupItem id="merge-category-none" :value="NO_CATEGORY" />
            <Label for="merge-category-none" class="cursor-pointer font-normal">
              {{ $t('payees.bulkMerge.noCategory') }}
            </Label>
          </div>
        </RadioGroup>
      </div>
    </div>

    <template #footer>
      <Button variant="ghost" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
      <Button
        variant="destructive"
        :disabled="!targetId || mergeMut.isPending.value"
        :loading="mergeMut.isPending.value"
        @click="handleMerge"
      >
        {{ $t('payees.bulkMerge.confirm') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import type { PayeeWithStats } from '@/api/payees';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { useNotificationCenter } from '@/components/notification-center';
import { useBulkMergePayees } from '@/composable/data-queries/payees';
import type { RecordId } from '@bt/shared/types';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import CategoryDisplay from './category-display.vue';

// Radio values must be strings, so "no default category" gets a sentinel.
const NO_CATEGORY = '__none__';

const props = defineProps<{
  payees: PayeeWithStats[];
}>();

const emit = defineEmits<{
  merged: [];
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const mergeMut = useBulkMergePayees();

const transactionCount = (payee: PayeeWithStats) => payee.stats?.transactionCount ?? 0;

const targetId = ref<string | null>(null);
const categoryChoice = ref<string>(NO_CATEGORY);

const target = computed(() => props.payees.find((payee) => payee.id === targetId.value) ?? null);

// The survivor's own category first, then the others in selection order.
const categoryIds = computed(() => {
  const ids = [target.value, ...props.payees]
    .map((payee) => payee?.defaultCategoryId)
    .filter((id): id is RecordId => !!id);
  return [...new Set(ids)];
});

const resetForm = () => {
  const busiest = props.payees.reduce<PayeeWithStats | null>(
    (best, payee) => (!best || transactionCount(payee) > transactionCount(best) ? payee : best),
    null,
  );
  targetId.value = busiest?.id ?? null;
  categoryChoice.value = categoryIds.value[0] ?? NO_CATEGORY;
};

watch(isOpen, (open) => {
  if (open) resetForm();
});

// Picking another survivor preselects its category, so the default choice is
// always "keep what the survivor has".
watch(targetId, () => {
  if (target.value?.defaultCategoryId) categoryChoice.value = target.value.defaultCategoryId;
});

async function handleMerge() {
  if (!target.value) return;
  const survivor = target.value;
  try {
    await mergeMut.mutateAsync({
      sourcePayeeIds: props.payees.filter((payee) => payee.id !== survivor.id).map((payee) => payee.id),
      targetPayeeId: survivor.id,
      defaultCategoryId: categoryChoice.value === NO_CATEGORY ? null : categoryChoice.value,
    });
    addSuccessNotification(
      t('payees.bulkMerge.success', {
        count: props.payees.length,
        name: survivor.name,
      }),
    );
    isOpen.value = false;
    emit('merged');
  } catch {
    addErrorNotification(t('payees.errors.generic'));
  }
}
</script>
