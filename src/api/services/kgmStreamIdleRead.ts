/**
 * KGM SSE：在 reader.read() 阻塞时仍能触发空闲检测（否则只能等上游关连接，常见 ~240s 空挂）。
 */
export async function readStreamChunkWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number
): Promise<ReadableStreamReadResult<Uint8Array> | 'idle'> {
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    return reader.read();
  }
  const ms = Math.min(Math.max(Math.floor(idleMs), 200), 120_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<'idle'>((resolve) => {
        timer = setTimeout(() => resolve('idle'), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
