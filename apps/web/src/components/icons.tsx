// The only icons in the app. Decorative: callers pair them with text.
type P = { className?: string };
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true } as const;

export const CheckIcon = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const CrossIcon = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
);
export const ExternalIcon = ({ className }: P) => (
  <svg {...base} strokeWidth={1.5} className={className}>
    <path d="M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
