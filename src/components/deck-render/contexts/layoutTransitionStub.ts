/** Copilot 无 deck 布局切换；供 OptimizedMermaidRenderer 兼容 deck API */
export function useLayoutTransition() {
  return {
    isLayoutTransitioning: false,
    startLayoutTransition: () => {},
    endLayoutTransition: () => {},
  };
}
