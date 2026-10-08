<script setup lang="ts">
import QRCode from 'qrcode'

// 公開 URL の QR コード。店頭 POP などに使うため PNG / SVG でダウンロードできる。

interface Props {
  url: string
  /** ダウンロード時のファイル名（拡張子なし） */
  fileName: string
}

const props = defineProps<Props>()

const svg = ref('')
const errorMessage = ref<string | null>(null)

watch(() => props.url, async (url) => {
  try {
    svg.value = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    errorMessage.value = null
  }
  catch {
    errorMessage.value = 'QR コードを生成できませんでした。'
  }
}, { immediate: true })

function download(href: string, extension: 'png' | 'svg'): void {
  const link = document.createElement('a')
  link.href = href
  link.download = `${props.fileName}.${extension}`
  link.click()
}

async function onDownloadPng(): Promise<void> {
  // 印刷しても荒れないよう大きめに書き出す
  download(await QRCode.toDataURL(props.url, { width: 1024, margin: 2 }), 'png')
}

function onDownloadSvg(): void {
  const blob = new Blob([svg.value], { type: 'image/svg+xml' })
  const href = URL.createObjectURL(blob)
  download(href, 'svg')
  URL.revokeObjectURL(href)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-4">
    <UiCommonAlert v-if="errorMessage" tone="danger">{{ errorMessage }}</UiCommonAlert>
    <!-- qrcode ライブラリが生成した SVG 文字列（外部入力を含まない） -->
    <div v-else class="size-36 shrink-0 rounded-lg border border-slate-200 bg-white p-2" role="img" :aria-label="`${url} の QR コード`" v-html="svg" />
    <div class="flex flex-col gap-2">
      <UiCommonButton variant="secondary" size="sm" icon="download" :is-disabled="!svg" @click="onDownloadPng">PNG をダウンロード</UiCommonButton>
      <UiCommonButton variant="secondary" size="sm" icon="download" :is-disabled="!svg" @click="onDownloadSvg">SVG をダウンロード</UiCommonButton>
    </div>
  </div>
</template>
