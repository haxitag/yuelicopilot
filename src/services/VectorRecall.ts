/**
 * 向量召回服务
 * 提供基于语义相似度的文档检索功能
 * 
 * 核心功能：
 * 1. 将文本内容分割成 segments
 * 2. 使用向量模型向量化文本
 * 3. 基于相似度检索相关 segments
 * 4. 返回最相关的 topN 结果
 */

export interface Segment {
  id: string;
  content: string;
  fileName: string;
  fileIndex: number;
  segmentIndex: number;
  embedding?: number[];
  keywords?: string[];
}

export interface RecallResult {
  segment: Segment;
  similarity: number;
}

export interface RecallConfig {
  topN: number;
  threshold: number;
  segmentSize: number;
  overlapSize: number;
}

const DEFAULT_CONFIG: RecallConfig = {
  topN: 5,
  threshold: 0.1,
  segmentSize: 500,
  overlapSize: 50
};

class VectorRecallService {
  private segments: Segment[] = [];
  private config: RecallConfig;

  constructor(config: Partial<RecallConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置配置
   */
  setConfig(config: Partial<RecallConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): RecallConfig {
    return { ...this.config };
  }

  /**
   * 中文分词（简单实现）
   */
  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    
    // 匹配中文词（2个及以上中文字符）
    const chinesePattern = /[\u4e00-\u9fa5]{2,}/g;
    let match;
    while ((match = chinesePattern.exec(text)) !== null) {
      tokens.push(match[0]);
    }
    
    // 匹配英文单词（2个及以上字母）
    const englishPattern = /[a-zA-Z]{2,}/g;
    while ((match = englishPattern.exec(text)) !== null) {
      tokens.push(match[0].toLowerCase());
    }
    
    // 匹配数字
    const numberPattern = /\d+/g;
    while ((match = numberPattern.exec(text)) !== null) {
      tokens.push(match[0]);
    }

    // 单字中文也加入（提高匹配率）
    const singleCharPattern = /[\u4e00-\u9fa5]/g;
    while ((match = singleCharPattern.exec(text)) !== null) {
      tokens.push(match[0]);
    }
    
    return tokens;
  }

  /**
   * 将文件内容分割成 segments
   */
  splitIntoSegments(files: Array<{ name: string; content: string }>): Segment[] {
    const segments: Segment[] = [];
    
    files.forEach((file, fileIndex) => {
      const content = file.content;
      if (!content || content.trim().length === 0) {
        return;
      }

      let start = 0;
      let segmentIndex = 0;
      const { segmentSize, overlapSize } = this.config;

      while (start < content.length) {
        const end = Math.min(start + segmentSize, content.length);
        let segmentContent = content.substring(start, end);

        // 如果不是最后一段，尽量在句子边界处分割
        if (end < content.length) {
          const lastPeriod = segmentContent.lastIndexOf('.');
          const lastNewline = segmentContent.lastIndexOf('\n');
          const lastChinesePeriod = segmentContent.lastIndexOf('。');
          const lastQuestion = segmentContent.lastIndexOf('？');
          const splitPoint = Math.max(lastPeriod, lastNewline, lastChinesePeriod, lastQuestion);
          
          if (splitPoint > segmentSize * 0.5) {
            segmentContent = segmentContent.substring(0, splitPoint + 1);
            start = splitPoint + 1 - overlapSize;
          } else {
            start = end - overlapSize;
          }
        } else {
          start = end;
        }

        // 确保起始位置不小于0
        if (start < 0) start = 0;

        // 提取关键词
        const keywords = this.tokenize(segmentContent);

        segments.push({
          id: `segment-${fileIndex}-${segmentIndex}-${Date.now()}`,
          content: segmentContent.trim(),
          fileName: file.name,
          fileIndex,
          segmentIndex,
          keywords
        });

        segmentIndex++;
      }
    });

    console.log(`🔪 分割完成：${files.length} 个文件 → ${segments.length} 个 segments`);
    return segments;
  }

  /**
   * 计算简单的词匹配相似度
   */
  private calculateSimilarity(queryTokens: string[], segmentTokens: string[]): number {
    if (queryTokens.length === 0 || segmentTokens.length === 0) {
      return 0;
    }

    const querySet = new Set(queryTokens);
    const segmentSet = new Set(segmentTokens);
    
    // 计算匹配的词数
    let matches = 0;
    querySet.forEach(token => {
      if (segmentSet.has(token)) {
        matches++;
      }
    });

    // 相似度 = 匹配词数 / 查询词数
    const similarity = matches / querySet.size;
    return similarity;
  }

  /**
   * 向量化所有 segments
   */
  indexSegments(files: Array<{ name: string; content: string }>): void {
    this.segments = this.splitIntoSegments(files);
    console.log(`📊 索引完成：${this.segments.length} 个 segments`);
  }

  /**
   * 检索相关 segments
   * @param query 用户查询
   * @param topN 返回前N个结果（默认5）
   * @param threshold 相似度阈值（默认0.1）
   */
  recall(query: string, topN?: number, threshold?: number): RecallResult[] {
    const n = topN || this.config.topN;
    const minSimilarity = threshold ?? this.config.threshold;

    if (this.segments.length === 0) {
      console.warn('⚠️ 没有已索引的 segments');
      return [];
    }

    // 分词查询
    const queryTokens = this.tokenize(query);
    
    if (queryTokens.length === 0) {
      console.warn('⚠️ 查询为空或无法分词');
      return [];
    }

    console.log(`🔍 查询分词结果: ${queryTokens.join(', ')}`);

    // 计算相似度
    const results: RecallResult[] = [];
    
    this.segments.forEach(segment => {
      if (!segment.keywords || segment.keywords.length === 0) return;
      
      const similarity = this.calculateSimilarity(queryTokens, segment.keywords);
      
      if (similarity >= minSimilarity) {
        results.push({
          segment,
          similarity
        });
      }
    });

    // 按相似度排序并取前N个
    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, n);

    console.log(`🔍 检索完成：查询 "${query.substring(0, 30)}..." → 找到 ${topResults.length} 个相关 segments`);
    topResults.forEach((result, idx) => {
      console.log(`  ${idx + 1}. [${(result.similarity * 100).toFixed(1)}%] ${result.segment.fileName}`);
    });

    return topResults;
  }

  /**
   * 检索并返回合并后的内容（去重后的文件内容）
   */
  recallMergedContent(query: string, topN?: number, threshold?: number): Array<{ name: string; content: string }> {
    const results = this.recall(query, topN, threshold);
    
    // 按文件分组并合并内容
    const fileMap = new Map<string, string>();
    
    results.forEach(result => {
      const existing = fileMap.get(result.segment.fileName);
      if (existing) {
        // 避免重复内容
        if (!existing.includes(result.segment.content)) {
          fileMap.set(result.segment.fileName, existing + '\n\n' + result.segment.content);
        }
      } else {
        fileMap.set(result.segment.fileName, result.segment.content);
      }
    });

    return Array.from(fileMap.entries()).map(([name, content]) => ({
      name,
      content: content.trim()
    }));
  }

  /**
   * 获取当前已索引的 segments 数量
   */
  getSegmentCount(): number {
    return this.segments.length;
  }

  /**
   * 清空所有索引
   */
  clear(): void {
    this.segments = [];
    console.log('🗑️ 索引已清空');
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    segmentCount: number;
    config: RecallConfig;
  } {
    return {
      segmentCount: this.segments.length,
      config: this.getConfig()
    };
  }
}

// 创建单例实例
export const vectorRecallService = new VectorRecallService();
