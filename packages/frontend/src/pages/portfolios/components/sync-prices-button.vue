<template>
  <UiButton
    v-if="canSync"
    variant="outline"
    size="sm"
    :disabled="syncMutation.isPending.value"
    @click="syncMutation.mutate()"
  >
    <RefreshCwIcon :class="cn('size-4', syncMutation.isPending.value && 'animate-spin')" />
    {{ $t('portfolioDetail.actions.syncPrices') }}
  </UiButton>
</template>

<script setup lang="ts">
import { triggerSecuritiesPriceSync } from '@/api/investments';
import { config } from '@/common/config';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { invalidatePortfolioState } from '@/composable/data-queries/invalidate-portfolio-state';
import { useIsAdmin } from '@/composable/use-is-admin';
import { isApiErrorWithCode } from '@/js/errors';
import { cn } from '@/lib/utils';
import { API_ERROR_CODES } from '@bt/shared/types';
import { RefreshCwIcon } from '@lucide/vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const queryClient = useQueryClient();
const { isAdmin } = useIsAdmin();

// Mirrors the server rule: every user on a self-hosted instance, admins only on the hosted service.
const canSync = computed(() => config.isSelfHost || isAdmin.value);

const syncMutation = useMutation({
  mutationFn: triggerSecuritiesPriceSync,
  onSuccess: () => {
    invalidatePortfolioState({ queryClient });
    addNotification({ text: t('portfolioDetail.syncPrices.success'), type: NotificationType.success });
  },
  onError: (error: unknown) => {
    addNotification({
      text: isApiErrorWithCode(error, API_ERROR_CODES.tooManyRequests)
        ? t('portfolioDetail.syncPrices.rateLimited')
        : t('portfolioDetail.syncPrices.failed'),
      type: NotificationType.error,
    });
  },
});
</script>
