type P = { className?: string };

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconTarget = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </svg>
);

export const IconMap = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 6.5 9 4.5v13L4 19.5z" />
    <path d="m9 4.5 6 2v13l-6-2z" />
    <path d="m15 6.5 5-2v13l-5 2z" />
  </svg>
);

export const IconBook = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" />
    <path d="M18 19.5H7a2 2 0 0 0 0 4h11" />
    <path d="M9 9h6M9 12.5h4" />
  </svg>
);

export const IconChart = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 19.5V4.5" />
    <path d="M4 19.5h16" />
    <path d="m7.5 15 3.5-4.5 3 2.5L19 7" />
  </svg>
);

export const IconGear = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h8M16 17h4" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="14" cy="17" r="2" />
  </svg>
);

export const IconFire = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3s5 4 5 8.5A5 5 0 0 1 7 11.5C7 8 9 6 9 6s0 2.5 1.5 3C11.5 8 12 5.5 12 3Z" />
  </svg>
);

export const IconHand = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.3 12.2 2.6 2.6 5-5.4" />
  </svg>
);
