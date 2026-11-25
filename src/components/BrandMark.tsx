import React from 'react';

interface BrandMarkProps {
  className?: string;
}

/**
 * Clean geometric center emblem (book spine + check arc) replacing generic sparkle icons.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({ className = 'w-7 h-7' }) => {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2"
        y="2"
        width="32"
        height="32"
        rx="9"
        className="fill-[#174E50] dark:fill-[#147477]"
      />
      <path
        d="M11 12.5C11 11.12 12.12 10 13.5 10H17V25H13.5C12.12 25 11 23.88 11 22.5V12.5Z"
        className="fill-[#D8E8DC] dark:fill-teal-100"
      />
      <path
        d="M19 10H22.5C23.88 10 25 11.12 25 12.5V22.5C25 23.88 23.88 25 22.5 25H19V10Z"
        className="fill-white/95"
      />
      <path
        d="M14.2 18.2L16.7 20.7L22.2 14.8"
        stroke="#0F766E"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
