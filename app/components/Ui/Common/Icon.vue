<script setup lang="ts">
// 管理画面で使う線画アイコン（24x24, stroke）。外部アイコンライブラリを入れずに済ませるための最小セット。

export type IconName =
  | 'home' | 'store' | 'survey' | 'ranking' | 'settings' | 'logout' | 'plus' | 'copy' | 'external'
  | 'chevron-up' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'trash' | 'qr' | 'check' | 'alert'
  | 'menu' | 'x' | 'refresh' | 'download' | 'user' | 'switch' | 'google' | 'star' | 'map-pin' | 'megaphone' | 'image'

interface Props {
  name: IconName
  /** Tailwind のサイズクラス */
  sizeClass?: string
}

withDefaults(defineProps<Props>(), { sizeClass: 'size-5' })

const PATHS: Record<IconName, string[]> = {
  'megaphone': ['M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z', 'M15 9a3 3 0 0 1 0 6', 'M18 6a7 7 0 0 1 0 12'],
  'image': ['M4 5h16v14H4z', 'm4 16 5-5 4 4 2-2 5 5', 'M15.5 9.5h.01'],
  'home': ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'],
  'store': ['M4 9h16l-1-5H5L4 9Z', 'M4 9v11h16V9', 'M9 20v-6h6v6', 'M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9'],
  'survey': ['M8 4h8v3H8z', 'M6 5.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1', 'm8 12 2 2 4-4', 'M8 17h8'],
  'ranking': ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  'settings': ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'],
  'logout': ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  'plus': ['M12 5v14', 'M5 12h14'],
  'copy': ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  'external': ['M14 3h7v7', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  'chevron-up': ['m18 15-6-6-6 6'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  'trash': ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  'qr': ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h3v3h-3z', 'M20 14v.01', 'M14 20h.01', 'M17 20h4v-3'],
  'check': ['M20 6 9 17l-5-5'],
  'alert': ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  'menu': ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  'x': ['M18 6 6 18', 'm6 6 12 12'],
  'refresh': ['M21 12a9 9 0 0 1-15.5 6.2L3 16', 'M3 21v-5h5', 'M3 12a9 9 0 0 1 15.5-6.2L21 8', 'M21 3v5h-5'],
  'download': ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  'user': ['M20 21a8 8 0 0 0-16 0', 'M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z'],
  'switch': ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
  'google': ['M21 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.1a4.4 4.4 0 0 1-1.9 2.9v2.4h3.1c1.8-1.7 2.7-4.1 2.7-7Z', 'M12 21.5c2.6 0 4.7-.9 6.3-2.3l-3.1-2.4c-.9.6-2 .9-3.2.9-2.5 0-4.6-1.7-5.3-3.9H3.5v2.5a9.5 9.5 0 0 0 8.5 5.2Z', 'M6.7 13.8a5.7 5.7 0 0 1 0-3.6V7.7H3.5a9.5 9.5 0 0 0 0 8.6l3.2-2.5Z', 'M12 6.3c1.4 0 2.6.5 3.6 1.4l2.7-2.7A9.5 9.5 0 0 0 3.5 7.7l3.2 2.5C7.4 8 9.5 6.3 12 6.3Z'],
  'star': ['m12 2.5 2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1L12 2.5Z'],
  'map-pin': ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
}
</script>

<template>
  <svg
    :class="sizeClass"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, index) in PATHS[name]" :key="index" :d="d" />
  </svg>
</template>
