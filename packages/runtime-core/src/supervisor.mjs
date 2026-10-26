/** @type {import('node:child_process').ChildProcess[]} */
let children = [];

/**
 * @param {import('node:child_process').ChildProcess} child
 */
export function registerChild(child) {
  children.push(child);
}

export function shutdownAll() {
  console.log('');
  console.log('🛑 正在停止所有服务...');
  for (const child of children) {
    const pid = child.pid;
    if (!pid) continue;
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`   已停止 PID ${pid}`);
    } catch {
      /* ignore */
    }
  }
  children = [];
}

export function installSignalHandlers() {
  const onSignal = () => {
    shutdownAll();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}
