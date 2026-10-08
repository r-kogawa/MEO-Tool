<script setup lang="ts">
import type { SurveyStatus } from '~/types/domain'
import type { BadgeTone } from '~/components/Ui/Common/Badge.vue'

interface Props {
  status: SurveyStatus
}

defineProps<Props>()

const TONES: Record<SurveyStatus, BadgeTone> = {
  draft: 'neutral',
  published: 'success',
  paused: 'warning',
  closed: 'neutral',
}
</script>

<template>
  <UiCommonBadge :tone="TONES[status]">{{ SURVEY_STATUS_LABELS[status] }}</UiCommonBadge>
</template>
