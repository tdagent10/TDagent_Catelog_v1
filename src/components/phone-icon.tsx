type IconProps = { className?: string };

export function PhoneIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M10.5 18.4h3" />
    </svg>
  );
}
