import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import {
  documentIndexingQueue,
  type DocumentIndexJobSnapshot
} from '../services/documents/documentIndexingQueue';

const Panel = styled.div`
  position: fixed;
  left: 18px;
  bottom: 18px;
  z-index: 1190;
  width: min(380px, calc(100vw - 36px));
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
  color: #1f2937;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #eff6ff;
  font-size: 13px;
  font-weight: 650;
`;

const Body = styled.div`
  padding: 8px 12px 12px;
`;

const Row = styled.div`
  padding: 6px 0;
`;

const Meta = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #475569;
`;

const Track = styled.div`
  height: 5px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
`;

const Fill = styled.div<{ $value: number; $failed?: boolean }>`
  width: ${({ $value }) => `${Math.max(2, Math.min(100, $value))}%`};
  height: 100%;
  background: ${({ $failed }) => ($failed ? '#ef4444' : '#2563eb')};
`;

const Button = styled.button`
  height: 26px;
  padding: 0 9px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  font-size: 12px;
  cursor: pointer;
`;

function isVisibleJob(job: DocumentIndexJobSnapshot): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'paused' || job.status === 'failed';
}

function statusLabel(status: DocumentIndexJobSnapshot['status']): string {
  switch (status) {
    case 'queued':
      return '等待';
    case 'running':
      return '索引中';
    case 'paused':
      return '已暂停';
    case 'failed':
      return '失败';
    case 'completed':
      return '完成';
    default:
      return status;
  }
}

const DocumentIndexingStatusPanel: React.FC = () => {
  const [jobs, setJobs] = useState<DocumentIndexJobSnapshot[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => documentIndexingQueue.subscribe(setJobs), []);

  const visibleJobs = useMemo(() => jobs.filter(isVisibleJob).slice(-4), [jobs]);
  if (hidden || visibleJobs.length === 0) return null;

  const hasPaused = visibleJobs.some((job) => job.status === 'paused');
  const hasRunning = visibleJobs.some((job) => job.status === 'running' || job.status === 'queued');

  return (
    <Panel>
      <Header>
        <span>文档索引</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasRunning && (
            <Button type="button" onClick={() => documentIndexingQueue.pause()}>
              暂停
            </Button>
          )}
          {hasPaused && (
            <Button type="button" onClick={() => documentIndexingQueue.resume()}>
              继续
            </Button>
          )}
          <Button type="button" onClick={() => setHidden(true)}>
            隐藏
          </Button>
        </div>
      </Header>
      <Body>
        {visibleJobs.map((job) => {
          const progress = job.totalChunks > 0 ? (job.indexedChunks / job.totalChunks) * 100 : 0;
          return (
            <Row key={job.id}>
              <Meta>
                <span title={job.fileName}>{job.fileName}</span>
                <span>
                  {statusLabel(job.status)} {job.indexedChunks}/{job.totalChunks}
                </span>
              </Meta>
              <Track>
                <Fill $value={progress} $failed={job.status === 'failed'} />
              </Track>
              {job.status === 'failed' && (
                <Meta style={{ marginTop: 5 }}>
                  <span>{job.error || '索引失败'}</span>
                  <Button type="button" onClick={() => documentIndexingQueue.retry(job.id)}>
                    重试
                  </Button>
                </Meta>
              )}
            </Row>
          );
        })}
      </Body>
    </Panel>
  );
};

export default DocumentIndexingStatusPanel;
