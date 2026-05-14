import React, { useState } from 'react';
import { Checkbox } from 'antd';

const SkillManagerTest: React.FC = () => {
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const prompts = [
    { id: 'test-1', name: '测试提示1', content: '测试内容1' },
    { id: 'test-2', name: '测试提示2', content: '测试内容2' }
  ];

  const handleTogglePromptSelection = (promptId: string) => {
    setSelectedPrompts(prev => 
      prev.includes(promptId)
        ? prev.filter(id => id !== promptId)
        : [...prev, promptId]
    );
  };

  return (
    <div>
      <h1>Skill Manager Test</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {prompts.map((prompt) => (
          <div key={prompt.id} style={{ border: '1px solid #e8e8e8', padding: 12, width: 280 }}>
            <div onClick={() => handleTogglePromptSelection(prompt.id)} style={{ cursor: 'pointer' }}>
              <Checkbox 
                checked={selectedPrompts.includes(prompt.id)}
                onChange={() => handleTogglePromptSelection(prompt.id)}
                style={{ marginRight: 8 }}
                onClick={(e) => e.stopPropagation()}
              />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{prompt.name}</span>
            </div>
            <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0 0', paddingLeft: 24 }}>
              {prompt.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SkillManagerTest;