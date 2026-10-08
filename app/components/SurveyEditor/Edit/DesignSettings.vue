<script setup lang="ts">
// アンケート画面の冒頭文とお礼文

const { draft } = useInjectedSurveyEditor()
</script>

<template>
  <div v-if="draft" class="space-y-5">
    <UiInputTextareaField
      v-model="draft.design.intro"
      label="冒頭の案内文"
      :rows="3"
      :maxlength="200"
      hint="アンケートの最初に表示します"
    />
    <UiInputTextareaField
      v-model="draft.design.thanksMessage"
      label="お礼文"
      :rows="3"
      :maxlength="200"
      hint="回答完了画面に表示します"
    />
  </div>
</template>
