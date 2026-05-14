// 测试使用原生fetch调用Ollama API
export async function testFetchOllama(model: string, message: string, onData: (data: any) => void) {
  try {
    console.log('使用fetch发送Ollama消息:', { model, message });
    
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: message
        }],
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is null');
    }
    const decoder = new TextDecoder();
    let accumulatedData = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      accumulatedData += chunk;

      const lines = accumulatedData.split('\n');
      accumulatedData = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            onData(data);
          } catch (error) {
            console.error('解析Ollama流式数据失败:', error);
          }
        }
      }
    }
  } catch (error) {
    console.error('fetch发送Ollama消息失败:', error);
    throw error;
  }
}