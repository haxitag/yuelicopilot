import React, { useId } from 'react';

type AppPageLoadingSplashProps = {
  /**
   * route：路由级；overlay：全局遮罩；compact：会话区/空状态居中；
   * banner：横向条（历史分页顶栏、思考中等）
   */
  variant?: 'route' | 'overlay' | 'compact' | 'banner';
  message?: string;
  className?: string;
};

/**
 * 首屏 / 路由懒加载 / 全局 Loading / 会话内加载 共用的文档滚动动效（SVG + SMIL）。
 * 使用 currentColor，便于随主题与父级 color 变化。
 */
export const AppPageLoadingSplash: React.FC<AppPageLoadingSplashProps> = ({
  variant = 'route',
  message,
  className = '',
}) => {
  const rid = useId().replace(/:/g, '');
  const maskId = `yueliContentMask-${rid}`;

  const variantClass =
    variant === 'overlay'
      ? 'app-page-loading-splash--overlay'
      : variant === 'compact'
        ? 'app-page-loading-splash--compact'
        : variant === 'banner'
          ? 'app-page-loading-splash--banner'
          : 'app-page-loading-splash--route';
  const shellClass = `app-page-loading-splash ${variantClass} ${className}`.trim();

  const displayMessage =
    message?.trim() || (variant === 'overlay' ? '' : '加载中…');

  const svgBlock = (
    <div className="app-page-loading-splash__art" aria-hidden>
        <svg
          width={99}
          height={84}
          viewBox="0 0 99 84"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="app-page-loading-splash__svg"
        >
          <path
            opacity="0.5"
            d="M1.5 7C1.5 5.4087 2.13214 3.88258 3.25736 2.75736C4.38258 1.63214 5.9087 1 7.5 1H91.5C93.0913 1 94.6174 1.63214 95.7426 2.75736C96.8679 3.88258 97.5 5.4087 97.5 7V77C97.5 78.5913 96.8679 80.1174 95.7426 81.2426C94.6174 82.3679 93.0913 83 91.5 83H7.5C5.9087 83 4.38258 82.3679 3.25736 81.2426C2.13214 80.1174 1.5 78.5913 1.5 77V7Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M91.5 1H7.5C4.18629 1 1.5 3.68629 1.5 7V73C1.5 76.3137 4.18629 79 7.5 79H91.5C94.8137 79 97.5 76.3137 97.5 73V7C97.5 3.68629 94.8137 1 91.5 1Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path opacity="0.12" d="M9.5 17H89.5V18H9.5V17Z" fill="currentColor" />
          <rect x="9.5" y="9" width="60" height="4" rx="1" fill="currentColor" />
          <rect x="73.5" y="9" width="16" height="4" rx="1" fill="currentColor" />
          <defs>
            <clipPath id={maskId}>
              <rect x="9.5" y="22" width="80" height="50" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${maskId})`}>
            <g>
              <animateTransform
                attributeName="transform"
                type="translate"
                from="0 0"
                to="0 -120"
                dur="37.5s"
                repeatCount="indefinite"
              />
              <rect x="9.5" y="22" width="68" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="26" width="57" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="30" width="63" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="34" width="31" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="38" width="59" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="42" width="62" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="46" width="18" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="50" width="54" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="54" width="41" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="58" width="66" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="62" width="70" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="66" width="59" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="70" width="18" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="74" width="50" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="78" width="65" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="82" width="41" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="86" width="58" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="90" width="52" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="94" width="60" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="98" width="67" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="102" width="49" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="106" width="30" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="110" width="48" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="114" width="33" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="118" width="52" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="122" width="25" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="126" width="47" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="130" width="23" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="134" width="35" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="138" width="16" height="2" rx="1" fill="currentColor" />
            </g>
            <g>
              <animateTransform
                attributeName="transform"
                type="translate"
                from="0 120"
                to="0 0"
                dur="37.5s"
                repeatCount="indefinite"
              />
              <rect x="9.5" y="22" width="68" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="26" width="57" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="30" width="63" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="34" width="31" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="38" width="59" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="42" width="62" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="46" width="18" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="50" width="54" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="54" width="41" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="58" width="66" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="62" width="70" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="66" width="59" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="70" width="18" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="74" width="50" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="78" width="65" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="82" width="41" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="86" width="58" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="90" width="52" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="94" width="60" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="98" width="67" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="102" width="49" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="106" width="30" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="110" width="48" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="114" width="33" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="118" width="52" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="122" width="25" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="126" width="47" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="130" width="23" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="134" width="35" height="2" rx="1" fill="currentColor" />
              <rect x="9.5" y="138" width="16" height="2" rx="1" fill="currentColor" />
            </g>
          </g>
        </svg>
    </div>
  );

  if (variant === 'banner') {
    return (
      <div className={shellClass} role="status" aria-busy="true" aria-live="polite">
        <span className="app-page-loading-splash__sr">{displayMessage}</span>
        {svgBlock}
        <span className="app-page-loading-splash__caption-inline">{displayMessage}</span>
      </div>
    );
  }

  return (
    <div className={shellClass} role="status" aria-busy="true" aria-live="polite">
      <span className="app-page-loading-splash__sr">{displayMessage}</span>
      {svgBlock}
      {(variant === 'route' || variant === 'compact' || (variant === 'overlay' && Boolean(message?.trim()))) && (
        <p className="app-page-loading-splash__caption">
          {variant === 'overlay' ? String(message || '').trim() : displayMessage}
        </p>
      )}
    </div>
  );
};

/** 供 routes 中 Suspense 使用，避免每处重复写 JSX */
export const RouteSuspenseFallback: React.FC = () => <AppPageLoadingSplash variant="route" />;