export default function WebBuilderIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
        <path d="M3 9H21" stroke="currentColor" strokeWidth="2"/>
        <path d="M9 9V21" stroke="currentColor" strokeWidth="2"/>
        <circle cx="6" cy="6" r="0.5" fill="currentColor"/>
        <circle cx="8" cy="6" r="0.5" fill="currentColor"/>
        <circle cx="10" cy="6" r="0.5" fill="currentColor"/>
      </svg>
    </div>
  );
}
