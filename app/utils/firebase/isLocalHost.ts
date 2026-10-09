const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1']

/** 手元の開発サーバーで開いているか。true なら Functions を手元の Emulator に向ける */
export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTNAMES.includes(hostname)
}
