#!/usr/bin/env bash
# Emulator（Auth / Firestore / Functions / Storage）と画面をまとめて起動し、画面を Emulator に接続する。
# 使い方: npm run dev:emulator（Ctrl+C で終了すると、データを .emulator-data/ に保存して次回読み込む）
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_DIR=.emulator-data

# Emulator は Java 21 以上が必要。Homebrew の openjdk@21（keg-only）があれば PATH に足す
if [ -d /opt/homebrew/opt/openjdk@21/bin ]; then
  export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
fi

# Functions Emulator は lib/ を読むため、先にビルドする
npm --prefix functions run build

# 順位計測（rankCheckWorker）は @sparticuz/chromium の Linux 用 Chromium を使うため、Mac では起動できない（spawn ENOEXEC）。
# 手元の Chrome があればそれを使う（gmapsScraper.ts は CHROME_PATH を優先する）。すでに設定されていれば上書きしない
MAC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -z "${CHROME_PATH:-}" ] && [ -x "$MAC_CHROME" ]; then
  export CHROME_PATH="$MAC_CHROME"
fi

# googleOAuthCallback が使う URL（Emulator 用）
export OAUTH_CALLBACK_URL="http://127.0.0.1:5001/meo-tool-d98e5/asia-northeast1/googleOAuthCallback"
export ADMIN_APP_URL="http://localhost:3000"

# 前回の保存データがあるときだけ読み込む（無いフォルダを --import するとエラーになるため）
import_args=()
if [ -f "$DATA_DIR/firebase-export-metadata.json" ]; then
  import_args=(--import="$DATA_DIR")
fi

# emulators:exec はシグナルを自分だけが受けたとき（IDE の停止ボタンなど）に子の nuxt dev を止めない。
# 終了時に、このスクリプトと同じプロセスグループに残った nuxt dev を止める
cleanup() {
  pkill -TERM -g "$(ps -o pgid= $$ | tr -d ' ')" -f "nuxt dev" 2>/dev/null || true
}
trap cleanup EXIT

firebase emulators:exec --ui \
  --only auth,firestore,functions,storage \
  ${import_args[@]+"${import_args[@]}"} --export-on-exit="$DATA_DIR" \
  "NUXT_PUBLIC_USE_MOCK=false NUXT_PUBLIC_USE_EMULATOR=true nuxt dev"
