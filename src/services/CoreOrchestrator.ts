import {
  Message,
  Skill,
  SkillExecutionContext,
  MCPQuery,
  MCPResponse,
  OutputTemplate,
  RenderedOutput,
  ExecutionPlan,
  ExecutionResult,
} from '../types';

import { SkillExecutor } from './SkillExecutor';
import { MCPConnectorManager } from './MCPConnectorManager';
import { TemplateEngine } from './TemplateEngine';

export class CoreOrchestrator {
  private skillExecutor: SkillExecutor;
  private connectorManager: MCPConnectorManager;
  private templateEngine: TemplateEngine;

  constructor() {
    this.skillExecutor = new SkillExecutor();
    this.connectorManager = new MCPConnectorManager();
    this.templateEngine = new TemplateEngine();
  }

  getSkillExecutor(): SkillExecutor {
    return this.skillExecutor;
  }

  getConnectorManager(): MCPConnectorManager {
    return this.connectorManager;
  }

  getTemplateEngine(): TemplateEngine {
    return this.templateEngine;
  }

  analyzeInput(
    input: string,
    history: Message[],
    skills: Skill[]
  ): ExecutionPlan {
    const plan: ExecutionPlan = {
      skills: [],
      connectors: [],
    };

    // 1. 检测是否使用技能
    const skillId = this.skillExecutor.extractSkillFromInput(input);
    if (skillId) {
      plan.skills.push(skillId);
    }

    // 2. 检测是否使用连接器
    const connectorQuery = this.connectorManager.extractConnectorFromInput(input);
    if (connectorQuery) {
      plan.connectors.push(connectorQuery);
    }

    // 3. 检测是否使用模板
    const templateId = this.templateEngine.extractTemplateFromInput(input);
    if (templateId) {
      plan.outputTemplate = templateId;
    }

    return plan;
  }

  async execute(
    input: string,
    history: Message[],
    plan?: ExecutionPlan
  ): Promise<ExecutionResult> {
    if (!plan) {
      plan = this.analyzeInput(input, history, this.skillExecutor.getAllSkills());
    }

    const result: ExecutionResult = {
      success: true,
      skillResults: {},
      connectorResults: {},
    };

    try {
      // 1. 执行技能
      for (const skillId of plan.skills) {
        const skill = this.skillExecutor.getSkill(skillId);
        if (skill) {
          const context: SkillExecutionContext = {
            skill,
            userInput: input,
            history,
            variables: {},
          };

          const skillResult = await this.skillExecutor.executeSkill(skillId, context);
          if (skillResult.success && skillResult.result) {
            result.skillResults![skillId] = skillResult.result;
          } else {
            result.success = false;
            result.error = skillResult.error;
            return result;
          }
        }
      }

      // 2. 执行连接器查询
      for (const query of plan.connectors) {
        const connectorResult = await this.connectorManager.execute(query);
        result.connectorResults![query.connectorId] = connectorResult;

        if (!connectorResult.success) {
          result.success = false;
          result.error = connectorResult.error;
          return result;
        }
      }

      // 3. 渲染输出模板
      if (plan.outputTemplate) {
        const template = this.templateEngine.getTemplate(plan.outputTemplate);
        if (template) {
          const templateData = this.buildTemplateData(
            input,
            history,
            result.skillResults!,
            result.connectorResults!
          );

          result.renderedOutput = this.templateEngine.render({
            template,
            data: templateData,
            options: {
              escapeHtml: true,
            },
          });
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '执行失败',
      };
    }
  }

  private buildTemplateData(
    input: string,
    history: Message[],
    skillResults: Record<string, any>,
    connectorResults: Record<string, MCPResponse>
  ): Record<string, any> {
    const data: Record<string, any> = {
      input,
      timestamp: new Date().toLocaleString(),
    };

    // 添加技能结果
    Object.entries(skillResults).forEach(([skillId, result]) => {
      data[`skill_${skillId}`] = result;
    });

    // 添加连接器结果
    Object.entries(connectorResults).forEach(([connectorId, response]) => {
      if (response.success && response.data) {
        data[`connector_${connectorId}`] = response.data;
      }
    });

    // 从连接器结果中提取常用数据
    const weatherResult = connectorResults['weather-api'];
    if (weatherResult?.success && weatherResult?.data) {
      data.city = weatherResult.data.city || '未知';
      data.temperature = weatherResult.data.temp || 0;
      data.description = weatherResult.data.description || '晴天';
      data.humidity = weatherResult.data.humidity || 0;
      data.windSpeed = weatherResult.data.windSpeed || 0;
      data.pressure = weatherResult.data.pressure || 1013;
      data.visibility = weatherResult.data.visibility || 10;
    }

    // 添加历史消息摘要
    if (history.length > 0) {
      data.recentMessages = history.slice(-5).map(msg => ({
        role: msg.role,
        content: msg.content.substring(0, 100),
      }));
    }

    return data;
  }

  async processMessage(
    input: string,
    history: Message[],
    selectedSkills?: string[],
    selectedConnectors?: MCPQuery[],
    selectedTemplate?: string
  ): Promise<{
    enhancedPrompt?: string;
    connectorData?: Record<string, any>;
    renderedOutput?: RenderedOutput;
    shouldUseLLM: boolean;
  }> {
    const plan: ExecutionPlan = {
      skills: selectedSkills || [],
      connectors: selectedConnectors || [],
      outputTemplate: selectedTemplate,
    };

    if (plan.skills.length === 0) {
      const autoSkill = this.skillExecutor.extractSkillFromInput(input);
      if (autoSkill) {
        plan.skills.push(autoSkill);
      }
    }

    if (plan.connectors.length === 0) {
      const autoConnector = this.connectorManager.extractConnectorFromInput(input);
      if (autoConnector) {
        plan.connectors.push(autoConnector);
      }
    }

    if (!plan.outputTemplate) {
      plan.outputTemplate = this.templateEngine.extractTemplateFromInput(input) || undefined;
    }

    const result = await this.execute(input, history, plan);

    if (!result.success) {
      throw new Error(result.error);
    }

    let enhancedPrompt = input;
    let shouldUseLLM = true;

    if (result.skillResults && Object.keys(result.skillResults).length > 0) {
      const firstSkillResult = Object.values(result.skillResults)[0];
      if (typeof firstSkillResult === 'string') {
        enhancedPrompt = firstSkillResult;
      }
    }

    const connectorData: Record<string, any> = {};
    if (result.connectorResults) {
      Object.entries(result.connectorResults).forEach(([id, response]) => {
        if (response.success && response.data) {
          connectorData[id] = response.data;
        }
      });
    }

    if (Object.keys(connectorData).length > 0) {
      enhancedPrompt += `\n\n## 外部数据\n${JSON.stringify(connectorData, null, 2)}`;
    }

    if (result.renderedOutput) {
      shouldUseLLM = false;
    }

    return {
      enhancedPrompt,
      connectorData,
      renderedOutput: result.renderedOutput,
      shouldUseLLM,
    };
  }
}