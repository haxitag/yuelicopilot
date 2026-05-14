import React from 'react';
import styled from 'styled-components';
import { InferenceResult } from '../types';

interface InferenceResultRendererProps {
  result: InferenceResult;
}

const ResultContainer = styled.div`
  margin: 12px 0;
  padding: 12px;
  border-radius: 8px;
  background-color: #f8f9fa;
  border: 1px solid #e0e0e0;
`;

const ResultHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
`;

const ResultType = styled.span`
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  background-color: #e6f7ff;
  color: #1890ff;
  font-weight: 600;
`;

const ResultContent = styled.div`
  font-size: 14px;
  line-height: 1.5;
`;

const CodeBlock = styled.pre`
  background-color: #f1f3f4;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  margin: 8px 0;
`;

const ImageContainer = styled.div`
  margin: 8px 0;
  text-align: center;
`;

const ResultImage = styled.img`
  max-width: 100%;
  max-height: 400px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
`;

const TableContainer = styled.div`
  margin: 8px 0;
  overflow-x: auto;
`;

const ResultTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
`;

const TableHeader = styled.th`
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  background-color: #f8f9fa;
  text-align: left;
  font-weight: 600;
`;

const TableCell = styled.td`
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
`;

const InferenceResultRenderer: React.FC<InferenceResultRendererProps> = ({ result }) => {
  const renderContent = () => {
    switch (result.type) {
      case 'text':
        return <ResultContent>{result.content}</ResultContent>;
      case 'code':
        return (
          <CodeBlock>
            {result.content}
          </CodeBlock>
        );
      case 'image':
        return (
          <ImageContainer>
            <ResultImage src={result.content} alt="Inference result" />
          </ImageContainer>
        );
      case 'table':
        try {
          const tableData = JSON.parse(result.content);
          return (
            <TableContainer>
              <ResultTable>
                <thead>
                  <tr>
                    {tableData.headers.map((header: string, index: number) => (
                      <TableHeader key={index}>{header}</TableHeader>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.rows.map((row: string[], index: number) => (
                    <tr key={index}>
                      {row.map((cell: string, cellIndex: number) => (
                        <TableCell key={cellIndex}>{cell}</TableCell>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </ResultTable>
            </TableContainer>
          );
        } catch (error) {
          return <ResultContent>{result.content}</ResultContent>;
        }
      case 'audio':
        return (
          <ResultContent>
            <audio controls>
              <source src={result.content} type="audio/mpeg" />
              Your browser does not support the audio element.
            </audio>
          </ResultContent>
        );
      case 'video':
        return (
          <ResultContent>
            <video controls style={{ width: '100%', maxWidth: '600px' }}>
              <source src={result.content} type="video/mp4" />
              Your browser does not support the video element.
            </video>
          </ResultContent>
        );
      default:
        return <ResultContent>{result.content}</ResultContent>;
    }
  };

  return (
    <ResultContainer>
      <ResultHeader>
        <ResultType>{result.type.toUpperCase()}</ResultType>
      </ResultHeader>
      {renderContent()}
    </ResultContainer>
  );
};

export default InferenceResultRenderer;