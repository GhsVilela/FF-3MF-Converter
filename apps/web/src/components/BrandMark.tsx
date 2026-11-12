export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label="FF-3MF"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="3" fill="#09121a" />
      <path
        d="M20 7.5 31.5 14v12L20 32.5 8.5 26V14Z"
        fill="none"
        stroke="#00a0e9"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 14 20 20.5 31.5 14M20 20.5v12"
        fill="none"
        stroke="#00a0e9"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M25.5 7.5h7v7" fill="none" stroke="#e96114" strokeWidth="2" />
    </svg>
  );
}
