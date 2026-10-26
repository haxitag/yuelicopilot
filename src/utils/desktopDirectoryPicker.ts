/** Electron 系统目录选择；Web 端返回 null */
export async function pickDirectoryViaDesktop(): Promise<string | null> {
  const bridge = (
    window as Window & { yueliDesktop?: { pickDirectory?: () => Promise<string | null> } }
  ).yueliDesktop;
  if (!bridge?.pickDirectory) return null;
  return bridge.pickDirectory();
}
