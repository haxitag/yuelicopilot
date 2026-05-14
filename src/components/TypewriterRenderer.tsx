import React, { useState, useEffect } from 'react';
import styled from 'styled-components';

interface TypewriterRendererProps {
  content: string;
  speed?: number;
  loop?: boolean;
}

const TypewriterContainer = styled.div`
  max-width: 70%;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const TypewriterSender = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: #1890ff;
  margin-bottom: 4px;
`;

const TypewriterContent = styled.div`
  padding: 12px 16px;
  border-radius: 8px;
  background-color: #f0f0f0;
  color: #666666;
  font-size: 14px;
  line-height: 1.5;
  font-style: italic;
  position: relative;
`;

const Cursor = styled.span`
  display: inline-block;
  width: 8px;
  height: 14px;
  background-color: #666666;
  margin-left: 4px;
  animation: blink 1s infinite;

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
`;

const TypewriterRenderer: React.FC<TypewriterRendererProps> = ({ 
  content, 
  speed = 50, 
  loop = false 
}) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < content.length) {
      const timeout = setTimeout(() => {
        setDisplayedContent(prev => prev + content[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);

      return () => clearTimeout(timeout);
    } else if (loop) {
      const timeout = setTimeout(() => {
        setDisplayedContent('');
        setCurrentIndex(0);
      }, 1000);

      return () => clearTimeout(timeout);
    }
  }, [currentIndex, content, speed, loop]);

  return (
    <TypewriterContainer>
      <TypewriterSender>Yueli Copilot</TypewriterSender>
      <TypewriterContent>
        {displayedContent}
        {currentIndex < content.length && <Cursor />}
      </TypewriterContent>
    </TypewriterContainer>
  );
};

export default TypewriterRenderer;