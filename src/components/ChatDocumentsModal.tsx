import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import toast from 'react-hot-toast';
import {
  addLongTermMemory,
  deleteSessionDocument,
  listLongTermMemories,
  listSessionDocuments
} from '../services/documents/documentServerStore';
import { useEscapeClose } from '../hooks/useEscapeClose';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
`;

const Panel = styled.div`
  width: 560px;
  max-width: 92vw;
  max-height: 80vh;
  overflow: auto;
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
`;

const Title = styled.h3`
  margin: 0 0 16px;
  font-size: 16px;
`;

const Section = styled.div`
  margin-bottom: 20px;
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
`;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  userId?: string;
};

const ChatDocumentsModal: React.FC<Props> = ({ isOpen, onClose, sessionId, userId }) => {
  const [docs, setDocs] = useState<Array<Record<string, unknown>>>([]);
  const [memories, setMemories] = useState<
    Array<{ id: string; title: string; content: string; tags?: string }>
  >([]);
  const [memTitle, setMemTitle] = useState('');
  const [memContent, setMemContent] = useState('');
  useEscapeClose(isOpen, onClose);

  const refresh = useCallback(async () => {
    if (sessionId) {
      setDocs(await listSessionDocuments(sessionId));
    }
    setMemories(await listLongTermMemories(userId));
  }, [sessionId, userId]);

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  return (
    <Overlay onClick={onClose}>
      <Panel onClick={(e) => e.stopPropagation()}>
        <Title>会话文档与长期记忆</Title>

        <Section>
          <strong>本会话已入库文档</strong>
          {!sessionId && <p style={{ fontSize: 12 }}>请先开始会话</p>}
          {sessionId &&
            (docs.length === 0 ? (
              <p style={{ fontSize: 12, color: '#999' }}>暂无</p>
            ) : (
              docs.map((d) => (
                <Row key={String(d.id)}>
                  <span>
                    {String(d.fileName || d.id)} · {String(d.chunkCount ?? 0)} 块
                  </span>
                  <button
                    type="button"
                    style={{ fontSize: 12 }}
                    onClick={async () => {
                      const ok = await deleteSessionDocument(String(d.id));
                      if (ok) {
                        toast.success('已删除');
                        void refresh();
                      } else toast.error('删除失败');
                    }}
                  >
                    删除
                  </button>
                </Row>
              ))
            ))}
        </Section>

        <Section>
          <strong>长期记忆（按 userId 召回）</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <input
              placeholder="标题"
              value={memTitle}
              onChange={(e) => setMemTitle(e.target.value)}
              style={{ padding: 8, border: '1px solid #d9d9d9', borderRadius: 4 }}
            />
            <textarea
              placeholder="内容"
              value={memContent}
              onChange={(e) => setMemContent(e.target.value)}
              rows={3}
              style={{ padding: 8, border: '1px solid #d9d9d9', borderRadius: 4 }}
            />
            <button
              type="button"
              onClick={async () => {
                if (!memContent.trim()) {
                  toast.error('请填写内容');
                  return;
                }
                const r = await addLongTermMemory({
                  userId,
                  title: memTitle || '未命名',
                  content: memContent
                });
                if (r.ok) {
                  toast.success('长期记忆已保存');
                  setMemTitle('');
                  setMemContent('');
                  void refresh();
                } else toast.error('保存失败');
              }}
            >
              保存长期记忆
            </button>
          </div>
          {memories.map((m) => (
            <Row key={m.id}>
              <span>
                <b>{m.title}</b> — {m.content.slice(0, 60)}
                {m.content.length > 60 ? '…' : ''}
              </span>
            </Row>
          ))}
        </Section>

        <button type="button" onClick={onClose}>
          关闭
        </button>
      </Panel>
    </Overlay>
  );
};

export default ChatDocumentsModal;
