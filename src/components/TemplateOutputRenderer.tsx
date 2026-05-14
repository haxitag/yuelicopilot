import React from 'react';
import styled from 'styled-components';

const RendererContainer = styled.div`
  width: 100%;
  height: 100%;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  background: white;
`;

const Iframe = styled.iframe`
  width: 100%;
  height: 500px;
  border: none;
  background: white;
`;

const DownloadButton = styled.button`
  margin-top: 10px;
  padding: 8px 16px;
  background: #4A90E2;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  
  &:hover {
    background: #357ABD;
  }
`;

interface HtmlRendererProps {
  html: string;
  filename?: string;
}

export const HtmlRenderer: React.FC<HtmlRendererProps> = ({ html, filename = 'output.html' }) => {
  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <RendererContainer>
        <Iframe
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin"
          title="HTML Preview"
        />
      </RendererContainer>
      <DownloadButton onClick={handleDownload}>
        下载HTML文件
      </DownloadButton>
    </div>
  );
};

interface JsonRendererProps {
  json: string;
  filename?: string;
}

export const JsonRenderer: React.FC<JsonRendererProps> = ({ json, filename = 'output.json' }) => {
  const handleDownload = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <pre style={{
        background: '#f5f5f5',
        padding: '16px',
        borderRadius: '8px',
        overflow: 'auto',
        maxHeight: '500px',
        fontSize: '13px',
        lineHeight: '1.5'
      }}>
        <code>{json}</code>
      </pre>
      <DownloadButton onClick={handleDownload}>
        下载JSON文件
      </DownloadButton>
    </div>
  );
};