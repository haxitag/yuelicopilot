/** 流式连接中断/空体等可尝试非流式回退的错误 */
export function isStreamDisconnectError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /network|failed to fetch|econnreset|socket|premature|aborted|body is null|连接中断|empty response/i.test(
    msg
  );
}
