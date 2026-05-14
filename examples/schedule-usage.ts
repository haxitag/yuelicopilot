/**
 * 定时任务与回调功能完整示例
 * 
 * 本示例展示如何使用新增的功能：
 * 1. 定时任务创建与管理
 * 2. 状态回调注册与触发
 * 3. 定时更新任务
 */

import {
  CoreOrchestratorV2,
  ScheduleStrategy,
  PluginStatus,
  TaskCallback
} from './src/services/core';

async function main() {
  console.log('=== 技能运行状态注册、回调与定时更新示例 ===\n');

  // 1. 创建并初始化编排器
  console.log('1. 初始化系统...');
  const orchestrator = new CoreOrchestratorV2();
  await orchestrator.initialize();
  console.log('   ✓ 系统初始化完成\n');

  // 2. 创建一个示例技能（模拟）
  console.log('2. 准备示例技能...');
  const pluginManager = orchestrator.getPluginManager();
  
  // 先创建一个简单的技能元数据
  const skillMetadata = {
    id: 'weather-skill',
    name: 'Weather Skill',
    version: '1.0.0',
    author: 'System',
    type: 'skill' as const,
    description: '获取天气信息的技能',
    dependencies: [],
    capabilities: ['weather', 'forecast'],
    permissions: [],
    configuration: {}
  };
  
  // 安装并启用技能
  await pluginManager.installSkill('weather-skill', skillMetadata);
  await pluginManager.enableSkill('weather-skill');
  console.log('   ✓ 技能已安装并启用\n');

  // 3. 示例1：创建定时任务
  console.log('3. 创建定时任务示例...');
  
  // 定义任务回调
  const taskCallback: TaskCallback = {
    onStart: (task, context) => {
      console.log(`   [${task.taskId}] 任务开始执行:`, task.name);
    },
    onComplete: (task, result) => {
      console.log(`   [${task.taskId}] 任务执行完成:`, result);
    },
    onError: (task, error) => {
      console.error(`   [${task.taskId}] 任务执行失败:`, error.message);
    },
    onProgress: (task, progress, message) => {
      console.log(`   [${task.taskId}] 进度: ${progress}% - ${message}`);
    },
    onRetry: (task, retryCount, error) => {
      console.log(`   [${task.taskId}] 第 ${retryCount} 次重试...`);
    }
  };
  
  // 创建定时任务 - 每5秒执行一次
  const task = orchestrator.createScheduleTask({
    pluginId: 'weather-skill',
    pluginType: 'skill',
    name: 'Weather Check',
    description: '定时检查天气信息',
    config: {
      strategy: ScheduleStrategy.INTERVAL,
      interval: 5000,  // 5秒
      maxRetries: 3,
      timeout: 30000
    },
    callback: taskCallback
  });
  
  console.log(`   ✓ 任务已创建: ${task.taskId}`);
  console.log(`   ✓ 下次执行: ${task.nextExecuteTime?.toLocaleTimeString()}\n`);

  // 4. 示例2：注册状态回调
  console.log('4. 注册状态回调示例...');
  
  // 注册技能执行状态回调
  const callbackId = orchestrator.registerStatusCallback(
    'weather-skill',
    'skill',
    [
      PluginStatus.EXECUTING,
      PluginStatus.COMPLETED,
      PluginStatus.FAILED,
      PluginStatus.ERROR
    ],
    (state, event) => {
      console.log(`   [状态变更] ${state.pluginId}: ${state.status}`);
      console.log(`               进度: ${state.progress}%`);
      if (state.progressMessage) {
        console.log(`               信息: ${state.progressMessage}`);
      }
    }
  );
  
  console.log(`   ✓ 状态回调已注册: ${callbackId}\n`);

  // 5. 示例3：注册定时更新
  console.log('5. 注册定时更新示例...');
  
  const updateScheduleId = orchestrator.registerUpdateSchedule({
    pluginId: 'weather-skill',
    pluginType: 'skill',
    interval: 10000,  // 10秒
    config: { location: 'Beijing' },
    callback: (data) => {
      console.log('   [定时更新] 数据更新:', data);
    }
  });
  
  console.log(`   ✓ 定时更新已注册: ${updateScheduleId}\n`);

  // 6. 启动任务
  console.log('6. 启动定时任务...');
  await orchestrator.startScheduleTask(task.taskId);
  console.log('   ✓ 任务已启动\n');

  // 7. 立即执行一次
  console.log('7. 立即执行任务（测试）...');
  try {
    const immediateResult = await orchestrator.executeTaskNow(task.taskId, {
      test: true,
      location: 'Shanghai'
    });
    console.log('   ✓ 立即执行结果:', immediateResult);
  } catch (error) {
    console.error('   ✗ 立即执行失败:', error);
  }
  console.log('');

  // 8. 获取任务列表
  console.log('8. 获取所有定时任务...');
  const allTasks = orchestrator.getAllScheduleTasks();
  console.log(`   ✓ 共 ${allTasks.length} 个任务:`);
  allTasks.forEach(t => {
    console.log(`       - ${t.name} (${t.taskId}): ${t.status}`);
  });
  console.log('');

  // 9. 演示任务暂停/恢复
  console.log('9. 演示任务暂停与恢复...');
  console.log('   暂停任务...');
  orchestrator.pauseScheduleTask(task.taskId);
  console.log('   ✓ 任务已暂停');
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('   恢复任务...');
  orchestrator.resumeScheduleTask(task.taskId);
  console.log('   ✓ 任务已恢复\n');

  // 10. 等待一段时间让任务执行几次
  console.log('10. 等待任务执行（15秒）...\n');
  console.log('    （你会看到定时任务和定时更新的输出）\n');
  
  // 让系统运行一段时间
  await new Promise(resolve => setTimeout(resolve, 15000));

  // 11. 清理
  console.log('11. 清理资源...');
  
  // 取消任务
  orchestrator.cancelScheduleTask(task.taskId);
  console.log('   ✓ 任务已取消');
  
  // 取消定时更新
  orchestrator.unregisterUpdateSchedule(updateScheduleId);
  console.log('   ✓ 定时更新已取消');
  
  // 注销回调
  orchestrator.unregisterStatusCallback(callbackId);
  console.log('   ✓ 回调已注销');
  
  // 清理ScheduleManager资源
  const scheduleManager = orchestrator.getScheduleManager();
  scheduleManager.destroy();
  
  console.log('\n=== 示例完成 ===');
}

// 导出供其他模块使用
export {
  main as runScheduleExample
};

// 如果直接运行此文件
if (require.main === module) {
  main().catch(error => {
    console.error('示例运行失败:', error);
    process.exit(1);
  });
}