import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { useChat, KnowledgeItem } from '../contexts/ChatContext';
import { toast } from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedKnowledge: string[];
  onSelectKnowledge: (ids: string[]) => void;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Overlay = styled.div`
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
`;
const Modal = styled.div`
  background: #fff; border-radius: 8px; padding: 24px;
  width: 560px; max-width: 95vw; max-height: 85vh;
  display: flex; flex-direction: column;
  box-shadow: 0 4px 24px rgba(0,0,0,0.15);
`;
const Header = styled.div`
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
`;
const Title = styled.h3`margin: 0; font-size: 17px; font-weight: 600; color: #1a1a1a;`;
const CloseBtn = styled.button`
  background: none; border: none; font-size: 20px; cursor: pointer; color: #999;
  &:hover { color: #333; }
`;
const Body = styled.div`flex: 1; overflow-y: auto; margin-bottom: 16px;`;
const ItemRow = styled.div<{ selected?: boolean; indexed?: boolean }>`
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
  border: 1px solid ${p => p.selected ? '#1890ff' : '#e8e8e8'};
  border-radius: 6px; margin-bottom: 8px; cursor: pointer;
  background: ${p => p.selected ? '#e6f4ff' : '#fff'};
  transition: all 0.2s;
  &:hover { border-color: #1890ff; }
`;
const ItemInfo = styled.div`flex: 1; min-width: 0;`;
const ItemName = styled.div`font-size: 14px; font-weight: 500; color: #1a1a1a; margin-bottom: 2px;`;
const ItemMeta = styled.div`font-size: 12px; color: #888; display: flex; gap: 8px; flex-wrap: wrap;`;
const Badge = styled.span<{ color?: string }>`
  padding: 1px 6px; border-radius: 8px; font-size: 11px;
  background: ${p => p.color === 'green' ? '#f6ffed' : p.color === 'blue' ? '#e6f4ff' : '#f5f5f5'};
  color: ${p => p.color === 'green' ? '#52c41a' : p.color === 'blue' ? '#1890ff' : '#666'};
  border: 1px solid ${p => p.color === 'green' ? '#b7eb8f' : p.color === 'blue' ? '#91caff' : '#d9d9d9'};
`;
const AddSection = styled.div`
  border: 1px dashed #d9d9d9; border-radius: 6px; padding: 12px;
  margin-top: 8px; background: #fafafa;
`;
const AddTitle = styled.div`font-size: 13px; font-weight: 500; color: #555; margin-bottom: 8px;`;
const AddBtnRow = styled.div`display: flex; gap: 8px; flex-wrap: wrap;`;
const AddBtn = styled.button`
  padding: 6px 14px; border: 1px solid #d9d9d9; border-radius: 5px;
  background: #fff; font-size: 13px; cursor: pointer; color: #555;
  transition: all 0.2s;
  &:hover { border-color: #1890ff; color: #1890ff; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const TextArea = styled.textarea`
  width: 100%; padding: 8px; border: 1px solid #d9d9d9; border-radius: 5px;
  font-size: 13px; resize: vertical; min-height: 80px; box-sizing: border-box;
  margin-top: 8px;
  &:focus { outline: none; border-color: #1890ff; }
`;
const UrlInput = styled.input`
  width: 100%; padding: 7px 10px; border: 1px solid #d9d9d9; border-radius: 5px;
  font-size: 13px; box-sizing: border-box; margin-top: 8px;
  &:focus { outline: none; border-color: #1890ff; }
`;
const Footer = styled.div`display: flex; justify-content: flex-end; gap: 10px;`;
const Btn = styled.button<{ primary?: boolean }>`
  padding: 7px 18px; border-radius: 5px; font-size: 14px; cursor: pointer;
  border: 1px solid ${p => p.primary ? '#1890ff' : '#d9d9d9'};
  background: ${p => p.primary ? '#1890ff' : '#fff'};
  color: ${p => p.primary ? '#fff' : '#555'};
  &:hover { opacity: 0.85; }
`;
const IndexingNote = styled.div`
  font-size: 12px; color: #888; margin-top: 6px; padding: 6px 10px;
  background: #f9f9f9; border-radius: 4px;
`;

// ── Component ─────────────────────────────────────────────────────────────────

const KnowledgeSelectionModal: React.FC<Props> = ({ isOpen, onClose, selectedKnowledge, onSelectKnowledge }) => {
  const { knowledgeItems, addKnowledgeItem, removeKnowledgeItem } = useChat();
  const [selected, setSelected] = useState<string[]>(selectedKnowledge);
  const [addMode, setAddMode] = useState<'none' | 'text' | 'url'>('none');
  const [textInput, setTextInput] = useState('');
  const [textName, setTextName] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // ── 添加本地文件 ──────────────────────────────────────────────────────────
  const handleAddFiles = useCallback(async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.xml,.yaml,.yml';
      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (!files) return;
        setLoading(true);
        for (const file of Array.from(files)) {
          try {
            const content = await file.text();
            const item: KnowledgeItem = {
              id: `file_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              name: file.name,
              content,
              type: 'file'
            };
            await addKnowledgeItem(item);
            setSelected(prev => [...prev, item.id]);
            toast.success(`已添加: ${file.name}`);
          } catch (err) {
            toast.error(`读取 ${file.name} 失败`);
          }
        }
        setLoading(false);
      };
      input.click();
    } catch (err) {
      toast.error('文件选择失败');
    }
  }, [addKnowledgeItem]);

  // ── 添加本地文件夹 ────────────────────────────────────────────────────────
  const handleAddFolder = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) {
      toast.error('浏览器不支持文件夹选择，请使用 Chrome/Edge');
      return;
    }
    try {
      setLoading(true);
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
      const textExts = new Set(['.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.xml', '.yaml', '.yml']);
      let count = 0;

      const readDir = async (handle: any, prefix = '') => {
        for await (const [name, entry] of handle.entries()) {
          if (entry.kind === 'file') {
            const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
            if (!textExts.has(ext)) continue;
            try {
              const file = await entry.getFile();
              const content = await file.text();
              if (content.trim().length === 0) continue;
              const item: KnowledgeItem = {
                id: `file_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                name: prefix ? `${prefix}/${name}` : name,
                content,
                type: 'file'
              };
              await addKnowledgeItem(item);
              setSelected(prev => [...prev, item.id]);
              count++;
            } catch {}
          } else if (entry.kind === 'directory' && !name.startsWith('.') && name !== 'node_modules') {
            await readDir(entry, prefix ? `${prefix}/${name}` : name);
          }
        }
      };

      await readDir(dirHandle);
      toast.success(`已添加文件夹 "${dirHandle.name}"，共 ${count} 个文件`);
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast.error('文件夹读取失败');
    } finally {
      setLoading(false);
    }
  }, [addKnowledgeItem]);

  // ── 添加文本片段 ──────────────────────────────────────────────────────────
  const handleAddText = useCallback(async () => {
    if (!textInput.trim()) { toast.error('请输入文本内容'); return; }
    setLoading(true);
    const item: KnowledgeItem = {
      id: `text_${Date.now()}`,
      name: textName.trim() || `文本片段 ${new Date().toLocaleTimeString()}`,
      content: textInput.trim(),
      type: 'text'
    };
    await addKnowledgeItem(item);
    setSelected(prev => [...prev, item.id]);
    setTextInput('');
    setTextName('');
    setAddMode('none');
    setLoading(false);
    toast.success('文本已添加');
  }, [textInput, textName, addKnowledgeItem]);

  // ── 添加 URL ──────────────────────────────────────────────────────────────
  const handleAddUrl = useCallback(async () => {
    if (!urlInput.trim()) { toast.error('请输入 URL'); return; }
    setLoading(true);
    try {
      const response = await fetch(urlInput.trim());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      // 简单提取正文文本
      const content = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50000);

      const item: KnowledgeItem = {
        id: `url_${Date.now()}`,
        name: urlInput.trim(),
        content,
        type: 'url'
      };
      await addKnowledgeItem(item);
      setSelected(prev => [...prev, item.id]);
      setUrlInput('');
      setAddMode('none');
      toast.success('URL 内容已添加');
    } catch (err: any) {
      toast.error(`获取 URL 失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [urlInput, addKnowledgeItem]);

  const handleSave = () => {
    onSelectKnowledge(selected);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Overlay onClick={e => e.target === e.currentTarget && onClose()}>
      <Modal>
        <Header>
          <Title>📚 项目主题知识库</Title>
          <CloseBtn onClick={onClose}>×</CloseBtn>
        </Header>

        <Body>
          {/* 已有知识库列表 */}
          {knowledgeItems.length === 0 && (
            <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              暂无知识库内容，请从下方添加
            </div>
          )}
          {knowledgeItems.map(item => (
            <ItemRow
              key={item.id}
              selected={selected.includes(item.id)}
              onClick={() => toggle(item.id)}
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => toggle(item.id)}
                onClick={e => e.stopPropagation()}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <ItemInfo>
                <ItemName>{item.name}</ItemName>
                <ItemMeta>
                  <Badge color="blue">{item.type === 'file' ? '文件' : item.type === 'url' ? 'URL' : '文本'}</Badge>
                  <span>{Math.round(item.content.length / 1000)}k 字符</span>
                  {item.indexed
                    ? <Badge color="green">✓ 已向量化 ({item.chunkCount} 块)</Badge>
                    : <Badge>未向量化（全量注入）</Badge>
                  }
                </ItemMeta>
              </ItemInfo>
              <button
                onClick={e => { e.stopPropagation(); removeKnowledgeItem(item.id); setSelected(p => p.filter(x => x !== item.id)); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 16, padding: '0 4px' }}
                title="删除"
              >×</button>
            </ItemRow>
          ))}

          {/* 添加区域 */}
          <AddSection>
            <AddTitle>添加知识内容</AddTitle>
            <AddBtnRow>
              <AddBtn disabled={loading} onClick={handleAddFiles}>📄 添加文件</AddBtn>
              <AddBtn disabled={loading} onClick={handleAddFolder}>📁 添加文件夹</AddBtn>
              <AddBtn disabled={loading} onClick={() => setAddMode(addMode === 'text' ? 'none' : 'text')}>✏️ 粘贴文本</AddBtn>
              <AddBtn disabled={loading} onClick={() => setAddMode(addMode === 'url' ? 'none' : 'url')}>🔗 抓取 URL</AddBtn>
            </AddBtnRow>

            {addMode === 'text' && (
              <div>
                <UrlInput
                  placeholder="知识片段名称（可选）"
                  value={textName}
                  onChange={e => setTextName(e.target.value)}
                />
                <TextArea
                  placeholder="粘贴文本内容..."
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <AddBtn disabled={loading} onClick={handleAddText}>
                    {loading ? '处理中...' : '添加'}
                  </AddBtn>
                  <AddBtn onClick={() => setAddMode('none')}>取消</AddBtn>
                </div>
              </div>
            )}

            {addMode === 'url' && (
              <div>
                <UrlInput
                  placeholder="https://..."
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <AddBtn disabled={loading} onClick={handleAddUrl}>
                    {loading ? '抓取中...' : '抓取并添加'}
                  </AddBtn>
                  <AddBtn onClick={() => setAddMode('none')}>取消</AddBtn>
                </div>
              </div>
            )}

            <IndexingNote>
              内容添加后会自动分块写入 KGM 向量索引（需配置 embedding）。
              未配置时内容仍可用，以全量方式注入 context。
            </IndexingNote>
          </AddSection>
        </Body>

        <Footer>
          <Btn onClick={onClose}>取消</Btn>
          <Btn primary onClick={handleSave}>
            确认选择 ({selected.length})
          </Btn>
        </Footer>
      </Modal>
    </Overlay>
  );
};

export default KnowledgeSelectionModal;
