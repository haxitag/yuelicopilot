/**
 * @param {{ kgmPort: number; executorPort: number }} ports
 */
export async function runE2eSelfTest(ports) {
  const { kgmPort, executorPort } = ports;

  console.log('');
  console.log('======================================');
  console.log('🧪 运行端到端自测...');
  console.log('======================================');

  console.log('→ executor /health');
  const execOk = await fetch(`http://127.0.0.1:${executorPort}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!execOk.ok) throw new Error('executor /health failed');
  console.log('   ✅ OK');

  console.log('→ kgm /v1/models');
  const modelsOk = await fetch(`http://127.0.0.1:${kgmPort}/v1/models`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!modelsOk.ok) throw new Error('kgm /v1/models failed');
  console.log('   ✅ OK');

  console.log('→ kgm /v1/chat/completions (qwen3.5:latest)');
  const start = Date.now();
  console.log('   ⏳ 请求中（最长 30s）...');

  const chatRes = await fetch(`http://127.0.0.1:${kgmPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3.5:latest',
      messages: [{ role: 'user', content: 'pong' }],
      stream: false,
      max_tokens: 64,
      kgm: { capabilities: { executeToolCalls: false } },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!chatRes.ok) throw new Error(`chat completions HTTP ${chatRes.status}`);

  const j = await chatRes.json();
  const content = j?.choices?.[0]?.message?.content ?? '';
  const cost = Math.round((Date.now() - start) / 1000);

  if (!content || String(content).includes('max_rounds_reached')) {
    console.log(`   ❌ FAIL：返回 content 为空或仍为 max_rounds_reached`);
    console.log(`   （耗时 ${cost}s）`);
    console.log(String(content).slice(0, 200));
    process.exit(2);
  }

  console.log(`   ✅ OK（耗时 ${cost}s）`);
}
