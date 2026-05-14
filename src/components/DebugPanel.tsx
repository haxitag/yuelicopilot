import React, { useState, useEffect } from 'react';
import styled from 'styled-components';

export interface DebugEntry {
  id: string;
  timestamp: number;
  type: 'request' | 'response' | 'transform' | 'error' | 'info';
  title: string;
  data: any;
  duration?: number;
}

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
  entries: DebugEntry[];
}

const Panel = styled.div<{ $isOpen: boolean }>`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: ${props => props.$isOpen ? '400px' : '0'};
  background: #1e1e1e;
  border-top: ${props => props.$isOpen ? '1px solid #333' : 'none'};
  transition: height 0.3s ease, border-top 0.3s ease;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #2d2d2d;
  cursor: pointer;
  
  &:hover {
    background: #333;
  }
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-weight: 600;
`;

const Toggle = styled.button`
  background: #007acc;
  color: white;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  
  &:hover {
    background: #0066b3;
  }
`;

const Content = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
`;

const Tabs = styled.div`
  display: flex;
  border-bottom: 1px solid #333;
`;

const Tab = styled.button<{ $active: boolean }>`
  background: ${props => props.$active ? '#373737' : '#2d2d2d'};
  color: ${props => props.$active ? '#00d4ff' : '#888'};
  border: none;
  border-bottom: 2px solid ${props => props.$active ? '#00d4ff' : 'transparent'};
  padding: 8px 16px;
  cursor: pointer;
  font-size: 12px;
  
  &:hover {
    background: #373737;
  }
`;

const LogList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px;
`;

const LogItem = styled.div<{ $type: string }>`
  padding: 8px;
  margin-bottom: 8px;
  background: ${props => {
    switch(props.$type) {
      case 'request': return '#1a365d';
      case 'response': return '#1a4731';
      case 'transform': return '#453459';
      case 'error': return '#5c2d2d';
      default: return '#2d2d2d';
    }
  }};
  border-radius: 4px;
  border-left: 3px solid ${props => {
    switch(props.$type) {
      case 'request': return '#3182ce';
      case 'response': return '#38a169';
      case 'transform': return '#805ad5';
      case 'error': return '#e53e3e';
      default: return '#666';
    }
  }};
`;

const LogHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
`;

const LogTitle = styled.span`
  color: #fff;
  font-size: 12px;
  font-weight: 500;
`;

const LogTime = styled.span`
  color: #888;
  font-size: 10px;
`;

const LogData = styled.pre`
  color: #a0aec0;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
`;

const FilterButtons = styled.div`
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
`;

const FilterButton = styled.button<{ $active: boolean }>`
  background: ${props => props.$active ? '#007acc' : '#333'};
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  
  &:hover {
    background: ${props => props.$active ? '#0066b3' : '#444'};
  }
`;

const ClearButton = styled.button`
  background: #5c2d2d;
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  margin-left: auto;
  
  &:hover {
    background: #7c3d3d;
  }
`;

export const DebugPanel: React.FC<DebugPanelProps> = ({ isOpen, onClose, entries }) => {
  const [activeTab, setActiveTab] = useState('all');
  const [filterType, setFilterType] = useState<string>('all');

  const filteredEntries = entries.filter(entry => {
    if (filterType === 'all') return true;
    return entry.type === filterType;
  });

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  };

  const formatData = (data: any) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  return (
    <Panel $isOpen={isOpen}>
      <Header onClick={onClose}>
        <Title>
          <span>🔧</span>
          <span>Debug Mode</span>
          <span style={{ color: '#00d4ff', fontSize: '11px' }}>
            ({filteredEntries.length} entries)
          </span>
        </Title>
        <Toggle onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}>
          {isOpen ? '收起' : '展开'}
        </Toggle>
      </Header>
      
      {isOpen && (
        <Content>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Tabs>
              <Tab $active={activeTab === 'log'} onClick={() => setActiveTab('log')}>
                请求日志
              </Tab>
              <Tab $active={activeTab === 'details'} onClick={() => setActiveTab('details')}>
                详细分析
              </Tab>
            </Tabs>
            
            {activeTab === 'log' && (
              <>
                <FilterButtons>
                  {[
                    { key: 'all', label: '全部' },
                    { key: 'request', label: '请求' },
                    { key: 'response', label: '响应' },
                    { key: 'transform', label: '转换' },
                    { key: 'error', label: '错误' },
                  ].map(filter => (
                    <FilterButton
                      key={filter.key}
                      $active={filterType === filter.key}
                      onClick={() => setFilterType(filter.key)}
                    >
                      {filter.label}
                    </FilterButton>
                  ))}
                  <ClearButton onClick={() => {
                    // 清空日志（由父组件处理）
                  }}>
                    清空
                  </ClearButton>
                </FilterButtons>
                
                <LogList>
                  {filteredEntries.length === 0 ? (
                    <div style={{ color: '#666', textAlign: 'center', padding: '16px' }}>
                      暂无日志
                    </div>
                  ) : (
                    filteredEntries.map(entry => (
                      <LogItem key={entry.id} $type={entry.type}>
                        <LogHeader>
                          <LogTitle>{entry.title}</LogTitle>
                          <LogTime>{formatTimestamp(entry.timestamp)}</LogTime>
                        </LogHeader>
                        {entry.duration && (
                          <div style={{ color: '#888', fontSize: '10px', marginBottom: '4px' }}>
                            耗时: {entry.duration}ms
                          </div>
                        )}
                        <LogData>{formatData(entry.data)}</LogData>
                      </LogItem>
                    ))
                  )}
                </LogList>
              </>
            )}
            
            {activeTab === 'details' && (
              <div style={{ flex: 1, padding: '12px', overflow: 'auto' }}>
                <h3 style={{ color: '#00d4ff', marginBottom: '12px' }}>📊 请求分析</h3>
                
                {entries.length > 0 && (
                  <>
                    <div style={{ marginBottom: '16px' }}>
                      <h4 style={{ color: '#fff', marginBottom: '8px' }}>最近请求</h4>
                      <div style={{ background: '#1a365d', padding: '8px', borderRadius: '4px' }}>
                        <pre style={{ color: '#a0aec0', fontSize: '11px', whiteSpace: 'pre-wrap' }}>
                          {formatData(entries[entries.length - 1]?.data || {})}
                        </pre>
                      </div>
                    </div>
                    
                    <div style={{ marginBottom: '16px' }}>
                      <h4 style={{ color: '#fff', marginBottom: '8px' }}>消息数量分析</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                        {['system', 'user', 'assistant', 'tool'].map(role => {
                          const count = entries.reduce((acc, entry) => {
                            if (entry.type === 'request' && entry.data.messages) {
                              return acc + entry.data.messages.filter((m: any) => m.role === role).length;
                            }
                            return acc;
                          }, 0);
                          return (
                            <div key={role} style={{ background: '#2d2d2d', padding: '8px', borderRadius: '4px' }}>
                              <span style={{ color: '#888', fontSize: '11px' }}>{role}</span>
                              <span style={{ color: '#00d4ff', fontSize: '18px', marginLeft: '8px' }}>
                                {count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    
                    <div>
                      <h4 style={{ color: '#fff', marginBottom: '8px' }}>响应延迟统计</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                        {['最小', '最大', '平均'].map((stat, idx) => {
                          const durations = entries.filter(e => e.duration).map(e => e.duration!);
                          let value = 0;
                          if (durations.length > 0) {
                            if (idx === 0) value = Math.min(...durations);
                            if (idx === 1) value = Math.max(...durations);
                            if (idx === 2) value = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
                          }
                          return (
                            <div key={stat} style={{ background: '#2d2d2d', padding: '8px', borderRadius: '4px' }}>
                              <span style={{ color: '#888', fontSize: '11px' }}>{stat}</span>
                              <span style={{ color: '#38a169', fontSize: '18px', marginLeft: '8px' }}>
                                {value}ms
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </Content>
      )}
    </Panel>
  );
};

export default DebugPanel;
