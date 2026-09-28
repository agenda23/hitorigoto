import type { ReactNode } from 'react'

// Inline SVG icons (no icon font / no external assets).
function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const SidebarIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </Icon>
)
export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const GhostIcon = () => (
  <Icon>
    <path d="M6 20V10a6 6 0 0 1 12 0v10l-3-2-3 2-3-2z" />
    <path d="M10 10h.01M14 10h.01" />
  </Icon>
)
export const ArrowUpIcon = () => (
  <Icon>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
)
export const StopIcon = () => (
  <Icon size={16}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </Icon>
)
export const CopyIcon = () => (
  <Icon size={16}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Icon>
)
export const RefreshIcon = () => (
  <Icon size={16}>
    <path d="M20 11a8 8 0 0 0-14-4L4 9M4 5v4h4M4 13a8 8 0 0 0 14 4l2-2M20 19v-4h-4" />
  </Icon>
)
export const TrashIcon = () => (
  <Icon size={16}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
)
export const ShieldIcon = () => (
  <Icon size={14}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
)
export const SearchIcon = () => (
  <Icon size={16}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
)
export const PinIcon = () => (
  <Icon size={16}>
    <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
  </Icon>
)
export const PencilIcon = () => (
  <Icon size={16}>
    <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />
  </Icon>
)
export const DownloadIcon = () => (
  <Icon size={16}>
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </Icon>
)
export const UploadIcon = () => (
  <Icon size={16}>
    <path d="M12 16V5M7 9l5-5 5 5M5 20h14" />
  </Icon>
)
export const MoreIcon = () => (
  <Icon size={16}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </Icon>
)
export const CheckIcon = () => (
  <Icon size={14}>
    <path d="M5 12l5 5 9-10" />
  </Icon>
)
export const ColumnsIcon = () => (
  <Icon size={16}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16M15 4v16" />
  </Icon>
)
export const ImageIcon = () => (
  <Icon size={16}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 16l-5-5-8 8" />
  </Icon>
)
export const HelpIcon = () => (
  <Icon size={16}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" />
  </Icon>
)
export const ActivityIcon = () => (
  <Icon size={16}>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Icon>
)
export const PersonaIcon = () => (
  <Icon size={16}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
  </Icon>
)
