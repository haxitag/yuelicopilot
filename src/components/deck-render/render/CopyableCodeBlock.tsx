import React from "react";

const CopyableCodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div style={{ position: "relative", margin: "8px 0" }}>
      <button
        onClick={handleCopy}
        style={{
          position: "absolute",
          right: 8,
          top: 8,
          zIndex: 2,
          fontSize: 12,
          padding: "2px 8px",
          borderRadius: 4,
          border: "1px solid #d1d5db",
          background: copied ? "#e0f7fa" : "#f6f8fa",
          color: "#007bff",
          cursor: "pointer"
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre
        style={{
          background: "#f6f8fa",
          padding: "16px",
          borderRadius: "6px",
          overflow: "auto",
          maxWidth: "100%",
          boxSizing: "border-box",
          border: "1px solid #e1e4e8",
          fontSize: "13px",
          lineHeight: "1.45",
          fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
          margin: 0
        }}
      >
        <code style={{ background: "none", padding: 0, fontSize: "inherit", color: "#24292e" }}>
          {code}
        </code>
      </pre>
    </div>
  );
};

export default CopyableCodeBlock;
