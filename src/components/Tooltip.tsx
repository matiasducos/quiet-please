'use client'

import type { ReactNode } from 'react'

export default function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="tooltip-wrap">
      {children}
      <span className="tooltip-bubble">{text}</span>
      <style>{`
        .tooltip-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .tooltip-bubble {
          visibility: hidden;
          opacity: 0;
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          min-width: 180px;
          max-width: 240px;
          padding: 8px 10px;
          background: #1a1a2e;
          color: #f0f0f0;
          font-family: var(--font-mono);
          font-size: 0.65rem;
          line-height: 1.5;
          letter-spacing: 0.01em;
          border-radius: 4px;
          white-space: normal;
          pointer-events: none;
          z-index: 50;
          transition: opacity 0.1s ease;
        }
        .tooltip-bubble::after {
          content: '';
          position: absolute;
          top: 100%;
          right: 12px;
          border: 5px solid transparent;
          border-top-color: #1a1a2e;
        }
        .tooltip-wrap:hover .tooltip-bubble {
          visibility: visible;
          opacity: 1;
        }
      `}</style>
    </span>
  )
}
