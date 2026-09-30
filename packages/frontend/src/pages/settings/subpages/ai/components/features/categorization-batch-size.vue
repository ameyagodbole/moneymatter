<template>
  <div class="mt-4 flex items-center justify-between gap-4 border-t pt-4">
    <div class="flex-1">
      <div class="flex items-center gap-2">
        <LayersIcon class="text-muted-foreground size-4" />
        <h5 class="text-sm font-medium">{{ $t('settings.ai.categorizationBatchSize.title') }}</h5>
      </div>
      <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
        {{ $t('settings.ai.categorizationBatchSize.description') }}
      </p>
    </div>
    <SelectField
      :model-value="selected"
      :values="options"
      :disabled="!canEdit || isPatching"
      class="w-24 shrink-0"
      @update:model-value="handleChange"
    />
  </div>
</template>

<script setup lang="ts">
import { SelectField } from '@/components/fields';
import { useNotificationCenter } from '@/components/notification-center';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useAiConnectionsList } from '@/composable/data-queries/use-ai-connections';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { AI_CATEGORIZATION_BATCH_SIZES, AI_CATEGORIZATION_DEFAULT_BATCH_SIZE, AI_FEATURE } from '@bt/shared/types';
import { LayersIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();
const { data: userSettings, patchAsync, isPatching } = useUserSettings();
const { getFeatureStatus } = useAiSettings();
const { connections } = useAiConnectionsList();

// Applies to the user's own connections only, the same as custom instructions.
const canEdit = computed(
  () => connections.value.length > 0 && getFeatureStatus(AI_FEATURE.categorization)?.servedBy !== 'server',
);

const options = AI_CATEGORIZATION_BATCH_SIZES.map((value) => ({ value, label: String(value) }));
const selected = computed(() => {
  const saved = userSettings.value?.ai?.categorizationBatchSize ?? AI_CATEGORIZATION_DEFAULT_BATCH_SIZE;
  return options.find((option) => option.value === saved) ?? null;
});

const handleChange = async (option: (typeof options)[number] | null) => {
  if (!option) return;
  try {
    await patchAsync({ ai: { categorizationBatchSize: option.value } });
  } catch {
    addErrorNotification(t('settings.ai.categorizationBatchSize.saveFailed'));
  }
};
</script>
