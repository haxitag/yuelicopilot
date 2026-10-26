const FIRST_RUN_DONE_KEY = 'yueli_first_run_done_v1';
const FIRST_RUN_SKIPPED_KEY = 'yueli_first_run_skipped_v1';

export function isFirstRunComplete(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    window.localStorage.getItem(FIRST_RUN_DONE_KEY) === '1' ||
    window.localStorage.getItem(FIRST_RUN_SKIPPED_KEY) === '1'
  );
}

export function markFirstRunComplete(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(FIRST_RUN_DONE_KEY, '1');
}

export function markFirstRunSkipped(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(FIRST_RUN_SKIPPED_KEY, '1');
}
