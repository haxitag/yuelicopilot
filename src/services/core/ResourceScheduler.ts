import { 
  ResourceSchedulingStrategy, 
  ResourceSchedulingConfig,
  ResourceInfo,
  RetryPolicy 
} from '../../types';

export class ResourceScheduler {
  private strategy: ResourceSchedulingStrategy;
  private config: ResourceSchedulingConfig;
  private resourcePool: Map<string, ResourceInfo>;
  private allocatedResources: Map<string, Set<string>>;
  private resourceUsage: Map<string, { cpu: number; memory: number }>;

  constructor(strategy: ResourceSchedulingStrategy, config?: ResourceSchedulingConfig) {
    this.strategy = strategy;
    this.config = config || { strategy };
    this.resourcePool = new Map();
    this.allocatedResources = new Map();
    this.resourceUsage = new Map();
  }

  registerResource(resource: ResourceInfo): void {
    this.resourcePool.set(resource.resourceId, resource);
    this.resourceUsage.set(resource.resourceId, { cpu: 0, memory: 0 });
  }

  unregisterResource(resourceId: string): void {
    this.resourcePool.delete(resourceId);
    this.resourceUsage.delete(resourceId);
  }

  async acquireResources(requesterId: string, requirements: ResourceSchedulingConfig): Promise<boolean> {
    const required = requirements.requiredResources;
    if (!required) return true;

    switch (this.strategy) {
      case ResourceSchedulingStrategy.PRIORITY:
        return this.acquireWithPriority(requesterId, required);
      case ResourceSchedulingStrategy.FAIR:
        return this.acquireWithFairness(requesterId, required);
      case ResourceSchedulingStrategy.RESOURCE_AWARE:
        return this.acquireWithResourceAwareness(requesterId, required);
      case ResourceSchedulingStrategy.LOAD_BALANCED:
        return this.acquireWithLoadBalancing(requesterId, required);
      case ResourceSchedulingStrategy.AFFINITY:
        return this.acquireWithAffinity(requesterId, required);
      default:
        return false;
    }
  }

  releaseResources(requesterId: string): void {
    const allocated = this.allocatedResources.get(requesterId);
    if (allocated) {
      allocated.forEach(resourceId => {
        const resource = this.resourcePool.get(resourceId);
        if (resource) {
          resource.status = 'available';
          resource.owner = undefined;
        }
      });
      this.allocatedResources.delete(requesterId);
    }
  }

  private acquireWithPriority(requesterId: string, required: { cpu?: number; memory?: number; network?: boolean; gpu?: boolean }): boolean {
    const priority = this.config.priority || 5;
    if (priority < 3) {
      return this.tryAllocate(requesterId, required);
    }
    return this.forceAllocate(requesterId, required);
  }

  private acquireWithFairness(requesterId: string, required: { cpu?: number; memory?: number; network?: boolean; gpu?: boolean }): boolean {
    const weight = this.config.weight || 1;
    if (weight < 0.5) {
      return false;
    }
    return this.tryAllocate(requesterId, required);
  }

  private acquireWithResourceAwareness(requesterId: string, required: { cpu?: number; memory?: number; network?: boolean; gpu?: boolean }): boolean {
    for (const [resourceId, resource] of this.resourcePool) {
      if (resource.status !== 'available') continue;

      const usage = this.resourceUsage.get(resourceId);
      if (!usage) continue;

      const hasCpu = !required.cpu || usage.cpu < 80;
      const hasMemory = !required.memory || usage.memory < 80;

      if (hasCpu && hasMemory) {
        return this.allocateResource(requesterId, resourceId);
      }
    }
    return false;
  }

  private acquireWithLoadBalancing(requesterId: string, required: { cpu?: number; memory?: number; network?: boolean; gpu?: boolean }): boolean {
    let minLoad = Infinity;
    let bestResource: string | null = null;

    for (const [resourceId, usage] of this.resourceUsage) {
      const totalLoad = usage.cpu + usage.memory;
      if (totalLoad < minLoad) {
        minLoad = totalLoad;
        bestResource = resourceId;
      }
    }

    if (bestResource) {
      return this.allocateResource(requesterId, bestResource);
    }
    return false;
  }

  private acquireWithAffinity(requesterId: string, required: { cpu?: number; memory?: number; network?: boolean; gpu?: boolean }): boolean {
    const preferred = this.config.preferredResources;
    if (!preferred) {
      return this.tryAllocate(requesterId, required);
    }

    for (const [resourceId, resource] of this.resourcePool) {
      if (resource.status !== 'available') continue;
      
      const matchesCpu = !preferred.cpu || !required.cpu || required.cpu <= 50;
      const matchesMemory = !preferred.memory || !required.memory || required.memory <= 50;

      if (matchesCpu && matchesMemory) {
        return this.allocateResource(requesterId, resourceId);
      }
    }

    return this.tryAllocate(requesterId, required);
  }

  private tryAllocate(requesterId: string, required: { cpu?: number; memory?: number; network?: boolean; gpu?: boolean }): boolean {
    for (const [resourceId, resource] of this.resourcePool) {
      if (resource.status !== 'available') continue;
      return this.allocateResource(requesterId, resourceId);
    }
    return false;
  }

  private forceAllocate(requesterId: string, required: { cpu?: number; memory?: number; network?: boolean; gpu?: boolean }): boolean {
    for (const [resourceId, resource] of this.resourcePool) {
      if (resource.status === 'error') continue;
      return this.allocateResource(requesterId, resourceId);
    }
    return false;
  }

  private allocateResource(requesterId: string, resourceId: string): boolean {
    const resource = this.resourcePool.get(resourceId);
    if (!resource) return false;

    resource.status = 'acquired';
    resource.owner = requesterId;
    resource.acquireTime = new Date();

    if (!this.allocatedResources.has(requesterId)) {
      this.allocatedResources.set(requesterId, new Set());
    }
    this.allocatedResources.get(requesterId)!.add(resourceId);

    return true;
  }

  calculateDelay(retryCount: number): number {
    const policy: RetryPolicy = this.config.retryPolicy || {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2
    };

    const delay = Math.min(
      policy.initialDelay * Math.pow(policy.backoffMultiplier, retryCount),
      policy.maxDelay
    );

    return delay;
  }

  isRetryable(error: string): boolean {
    const policy = this.config.retryPolicy;
    if (!policy || !policy.retryableErrors) return true;

    return policy.retryableErrors.some(retryable => 
      error.toLowerCase().includes(retryable.toLowerCase())
    );
  }

  getResourceUtilization(): Record<string, { cpu: number; memory: number; available: boolean }> {
    const utilization: Record<string, { cpu: number; memory: number; available: boolean }> = {};
    
    for (const [resourceId, resource] of this.resourcePool) {
      const usage = this.resourceUsage.get(resourceId) || { cpu: 0, memory: 0 };
      utilization[resourceId] = {
        cpu: usage.cpu,
        memory: usage.memory,
        available: resource.status === 'available'
      };
    }

    return utilization;
  }

  setStrategy(strategy: ResourceSchedulingStrategy, config?: ResourceSchedulingConfig): void {
    this.strategy = strategy;
    if (config) {
      this.config = config;
    }
  }

  getStrategy(): ResourceSchedulingStrategy {
    return this.strategy;
  }
}
