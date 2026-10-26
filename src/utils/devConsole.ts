/**
 * 开发环境控制台输出（生产构建静默）。
 */

export function devLog(...args: unknown[]): void {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
}

export function devError(...args: unknown[]): void {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
}

export function devDebug(...args: unknown[]): void {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.debug(...args);
  }
}
