import { SkillCollection, SkillCategory } from '../../types';

export class CollectionManager {
  private collections: Map<string, SkillCollection> = new Map();
  private readonly STORAGE_KEY = 'yueli_skill_collections';

  constructor() {
    this.loadFromStorage();
  }

  /**
   * 从本地存储加载集合
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const collections = JSON.parse(stored);
        collections.forEach((collection: SkillCollection) => {
          // 恢复日期对象
          collection.createdAt = new Date(collection.createdAt);
          collection.updatedAt = new Date(collection.updatedAt);
          this.collections.set(collection.id, collection);
        });
      }
    } catch (error) {
      console.error('Failed to load skill collections:', error);
    }
  }

  /**
   * 保存集合到本地存储
   */
  private saveToStorage(): void {
    try {
      const collections = Array.from(this.collections.values());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(collections));
    } catch (error) {
      console.error('Failed to save skill collections:', error);
    }
  }

  /**
   * 创建新集合
   */
  createCollection(
    name: string,
    description: string,
    options?: { icon?: string; color?: string }
  ): SkillCollection {
    const collection: SkillCollection = {
      id: `collection_${Date.now()}`,
      name,
      description,
      skillIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...options
    };

    this.collections.set(collection.id, collection);
    this.saveToStorage();

    return collection;
  }

  /**
   * 获取所有集合
   */
  getAllCollections(): SkillCollection[] {
    return Array.from(this.collections.values()).sort((a, b) => 
      b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  /**
   * 获取单个集合
   */
  getCollection(collectionId: string): SkillCollection | undefined {
    return this.collections.get(collectionId);
  }

  /**
   * 更新集合
   */
  updateCollection(
    collectionId: string,
    updates: Partial<Omit<SkillCollection, 'id' | 'createdAt'>>
  ): SkillCollection | undefined {
    const collection = this.collections.get(collectionId);
    if (!collection) return undefined;

    const updated: SkillCollection = {
      ...collection,
      ...updates,
      updatedAt: new Date()
    };

    this.collections.set(collectionId, updated);
    this.saveToStorage();

    return updated;
  }

  /**
   * 删除集合
   */
  deleteCollection(collectionId: string): boolean {
    const deleted = this.collections.delete(collectionId);
    if (deleted) {
      this.saveToStorage();
    }
    return deleted;
  }

  /**
   * 向集合添加技能
   */
  addSkillToCollection(collectionId: string, skillId: string): boolean {
    const collection = this.collections.get(collectionId);
    if (!collection) return false;

    if (!collection.skillIds.includes(skillId)) {
      collection.skillIds.push(skillId);
      collection.updatedAt = new Date();
      this.saveToStorage();
    }

    return true;
  }

  /**
   * 从集合移除技能
   */
  removeSkillFromCollection(collectionId: string, skillId: string): boolean {
    const collection = this.collections.get(collectionId);
    if (!collection) return false;

    const index = collection.skillIds.indexOf(skillId);
    if (index !== -1) {
      collection.skillIds.splice(index, 1);
      collection.updatedAt = new Date();
      this.saveToStorage();
    }

    return index !== -1;
  }

  /**
   * 批量添加技能到集合
   */
  addSkillsToCollection(collectionId: string, skillIds: string[]): boolean {
    const collection = this.collections.get(collectionId);
    if (!collection) return false;

    let added = false;
    skillIds.forEach(skillId => {
      if (!collection.skillIds.includes(skillId)) {
        collection.skillIds.push(skillId);
        added = true;
      }
    });

    if (added) {
      collection.updatedAt = new Date();
      this.saveToStorage();
    }

    return added;
  }

  /**
   * 获取包含特定技能的所有集合
   */
  getCollectionsForSkill(skillId: string): SkillCollection[] {
    return this.getAllCollections().filter(c => c.skillIds.includes(skillId));
  }

  /**
   * 检查技能是否在集合中
   */
  isSkillInCollection(collectionId: string, skillId: string): boolean {
    const collection = this.collections.get(collectionId);
    return collection ? collection.skillIds.includes(skillId) : false;
  }

  /**
   * 获取分类名称（用于UI显示）
   */
  getCategoryName(category: SkillCategory): string {
    const names: Record<SkillCategory, string> = {
      'coding': '代码开发',
      'writing': '文本创作',
      'analysis': '数据分析',
      'automation': '任务自动化',
      'database': '数据库操作',
      'file': '文件处理',
      'web': '网页与API',
      'productivity': '生产力工具',
      'system': '系统约束',
      'other': '其他'
    };
    return names[category] || category;
  }

  /**
   * 获取分类图标
   */
  getCategoryIcon(category: SkillCategory): string {
    const icons: Record<SkillCategory, string> = {
      'coding': '💻',
      'writing': '✍️',
      'analysis': '📊',
      'automation': '🤖',
      'database': '🗄️',
      'file': '📁',
      'web': '🌐',
      'productivity': '⚡',
      'system': '🔒',
      'other': '📦'
    };
    return icons[category] || '📦';
  }
}
