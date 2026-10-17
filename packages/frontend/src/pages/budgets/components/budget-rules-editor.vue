<script setup lang="ts">
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import PayeeMultiSelectField from '@/components/fields/payee-multi-select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Label } from '@/components/lib/ui/label';
import PillTabs from '@/components/lib/ui/pill-tabs/pill-tabs.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import type { BudgetRuleGroup, RecordId } from '@bt/shared/types';
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { createEmptyRule } from './budget-rules';

/** Upper bound the API accepts. */
const MAX_RULES = 20;

const props = defineProps<{
  modelValue: BudgetRuleGroup[];
  disabled?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: BudgetRuleGroup[]];
}>();

const { t } = useI18n();

const tagMatchItems = computed(() => [
  { value: 'any', label: t('budgets.rules.tagMatchAny') },
  { value: 'all', label: t('budgets.rules.tagMatchAll') },
]);

const updateRule = ({ index, patch }: { index: number; patch: Partial<BudgetRuleGroup> }) =>
  emit(
    'update:modelValue',
    props.modelValue.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
  );

const asIds = (values: string[]) => values as RecordId[];

const addRule = () => emit('update:modelValue', [...props.modelValue, createEmptyRule()]);
const removeRule = ({ index }: { index: number }) =>
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
</script>

<template>
  <div class="grid gap-3">
    <div>
      <Label class="block text-sm font-medium">{{ $t('budgets.rules.title') }}</Label>
      <p class="text-muted-foreground mt-1 text-xs">{{ $t('budgets.rules.description') }}</p>
    </div>

    <template v-for="(rule, index) in modelValue" :key="index">
      <div v-if="index > 0" class="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase">
        <span class="bg-border h-px flex-1" />
        {{ $t('budgets.rules.or') }}
        <span class="bg-border h-px flex-1" />
      </div>

      <div class="border-border grid gap-3 rounded-lg border p-3">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">{{ $t('budgets.rules.ruleTitle', { number: index + 1 }) }}</span>
          <DesktopOnlyTooltip v-if="modelValue.length > 1" :content="$t('budgets.rules.removeRule')">
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              :disabled="disabled"
              :aria-label="$t('budgets.rules.removeRule')"
              @click="removeRule({ index })"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>

        <CategoryMultiSelectField
          :model-value="rule.categoryIds"
          :label="$t('budgets.rules.categoriesLabel')"
          :placeholder="$t('budgets.rules.anyCategory')"
          :disabled="disabled"
          @update:model-value="updateRule({ index, patch: { categoryIds: asIds($event) } })"
        />

        <div class="grid gap-1.5">
          <TagSelectField
            :model-value="rule.tagIds"
            :label="$t('budgets.rules.tagsLabel')"
            :placeholder="$t('budgets.rules.anyTag')"
            :disabled="disabled"
            @update:model-value="updateRule({ index, patch: { tagIds: asIds($event) } })"
          />
          <PillTabs
            v-if="rule.tagIds.length > 1"
            :model-value="rule.tagMatch"
            :items="tagMatchItems"
            class="self-start"
            @update:model-value="updateRule({ index, patch: { tagMatch: $event as BudgetRuleGroup['tagMatch'] } })"
          />
        </div>

        <AccountMultiSelectField
          :model-value="rule.accountIds"
          :label="$t('budgets.rules.accountsLabel')"
          :placeholder="$t('budgets.rules.anyAccount')"
          :disabled="disabled"
          @update:model-value="updateRule({ index, patch: { accountIds: asIds($event) } })"
        />

        <div class="grid gap-1.5">
          <Label class="text-sm font-medium">{{ $t('budgets.rules.payeesLabel') }}</Label>
          <PayeeMultiSelectField
            :payee-ids="rule.payeeIds"
            :placeholder="$t('budgets.rules.anyPayee')"
            @update:payee-ids="updateRule({ index, patch: { payeeIds: asIds($event) } })"
          />
        </div>
      </div>
    </template>

    <p v-if="errorMessage" class="text-destructive-text text-xs">{{ errorMessage }}</p>

    <Button
      v-if="modelValue.length < MAX_RULES"
      variant="outline"
      size="sm"
      class="justify-self-start"
      :disabled="disabled"
      @click="addRule"
    >
      <PlusIcon class="size-4" />
      {{ $t('budgets.rules.addRule') }}
    </Button>
  </div>
</template>
