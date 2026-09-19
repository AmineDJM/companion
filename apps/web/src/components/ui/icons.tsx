import type { SVGProps } from 'react';

/**
 * A small, hand-picked icon set drawn on a 20px grid with a 1.6 stroke, so the
 * whole product shares one weight. No icon library, no robot glyphs.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 4.2v11.6M4.2 10h11.6" />
  </Icon>
);

export const LinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8.4 11.6a3 3 0 0 0 4.3 0l2.1-2.1a3 3 0 0 0-4.2-4.3l-1 1" />
    <path d="M11.6 8.4a3 3 0 0 0-4.3 0l-2.1 2.1a3 3 0 0 0 4.2 4.3l1-1" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="7" y="7" width="9" height="9" rx="2" />
    <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="9" r="5" />
    <path d="M12.8 12.8L16.5 16.5" />
  </Icon>
);

export const FileIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M11.5 2.8H6.5A1.5 1.5 0 0 0 5 4.3v11.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V6.3l-3.5-3.5Z" />
    <path d="M11.5 2.8v3.5H15" />
  </Icon>
);

export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.2 6.2a1.5 1.5 0 0 1 1.5-1.5h2.6l1.4 1.8h6.1a1.5 1.5 0 0 1 1.5 1.5v6.3a1.5 1.5 0 0 1-1.5 1.5H4.7a1.5 1.5 0 0 1-1.5-1.5V6.2Z" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3.5v8.5M6.5 9l3.5 3.5L13.5 9" />
    <path d="M4 14.5v1a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-1" />
  </Icon>
);

export const EyeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.8 10S4.7 5 10 5s8.2 5 8.2 5-2.9 5-8.2 5-8.2-5-8.2-5Z" />
    <circle cx="10" cy="10" r="2.2" />
  </Icon>
);

export const EyeOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7.4 5.4A7.7 7.7 0 0 1 10 5c5.3 0 8.2 5 8.2 5a14 14 0 0 1-2.4 2.9" />
    <path d="M12.9 12.6A4.6 4.6 0 0 1 10 15c-5.3 0-8.2-5-8.2-5a13.8 13.8 0 0 1 3.5-3.8" />
    <path d="M3 3l14 14" />
  </Icon>
);

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4.2l2.6 1.6" />
  </Icon>
);

export const ChartIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 16V9M10 16V4M16 16v-5" />
  </Icon>
);

export const ShieldIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 2.8l5.5 2v4.6c0 3.3-2.2 6.2-5.5 7.3-3.3-1.1-5.5-4-5.5-7.3V4.8l5.5-2Z" />
  </Icon>
);

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
    <path d="M7 8.5V6.6a3 3 0 0 1 6 0v1.9" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 5l5 5-5 5" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 8l5 5 5-5" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5l-5 5 5 5" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Icon>
);

export const MenuIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.8 5.5h12.4M8 5.5V4.2A1.2 1.2 0 0 1 9.2 3h1.6A1.2 1.2 0 0 1 12 4.2v1.3" />
    <path d="M5.4 5.5l.7 10a1.4 1.4 0 0 0 1.4 1.3h5a1.4 1.4 0 0 0 1.4-1.3l.7-10" />
  </Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16.2 8.2A6.4 6.4 0 0 0 5 6.3M3.8 11.8A6.4 6.4 0 0 0 15 13.7" />
    <path d="M16.5 4.5v3.7h-3.7M3.5 15.5v-3.7h3.7" />
  </Icon>
);

export const UploadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 15.5V7M6.5 10.5L10 7l3.5 3.5" />
    <path d="M4 14.5v1A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-1" />
  </Icon>
);

export const ExternalIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M11 4h5v5M16 4l-7 7" />
    <path d="M15 12v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" />
  </Icon>
);

export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7.5 4.5v11M12.5 4.5v11" />
  </Icon>
);

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 4.3l9 5.7-9 5.7V4.3Z" />
  </Icon>
);

export const BanIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="7" />
    <path d="M5 5l10 10" />
  </Icon>
);

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="2.4" />
    <path d="M15.8 12a1.3 1.3 0 0 0 .26 1.44l.05.05a1.6 1.6 0 1 1-2.26 2.26l-.05-.05a1.3 1.3 0 0 0-1.44-.26 1.3 1.3 0 0 0-.79 1.19v.14a1.6 1.6 0 1 1-3.2 0v-.07a1.3 1.3 0 0 0-.85-1.19 1.3 1.3 0 0 0-1.44.26l-.05.05a1.6 1.6 0 1 1-2.26-2.26l.05-.05a1.3 1.3 0 0 0 .26-1.44 1.3 1.3 0 0 0-1.19-.79h-.14a1.6 1.6 0 1 1 0-3.2h.07a1.3 1.3 0 0 0 1.19-.85 1.3 1.3 0 0 0-.26-1.44l-.05-.05A1.6 1.6 0 1 1 6.02 3.6l.05.05a1.3 1.3 0 0 0 1.44.26H7.6a1.3 1.3 0 0 0 .79-1.19v-.14a1.6 1.6 0 1 1 3.2 0v.07a1.3 1.3 0 0 0 .79 1.19 1.3 1.3 0 0 0 1.44-.26l.05-.05a1.6 1.6 0 1 1 2.26 2.26l-.05.05a1.3 1.3 0 0 0-.26 1.44v.06a1.3 1.3 0 0 0 1.19.79h.14a1.6 1.6 0 0 1 0 3.2h-.07a1.3 1.3 0 0 0-1.19.79Z" />
  </Icon>
);

export const UsersIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="7.5" r="2.6" />
    <path d="M3.2 16.2a4.8 4.8 0 0 1 9.6 0" />
    <path d="M13.4 5.2a2.6 2.6 0 0 1 0 4.9M15 16.2a4.7 4.7 0 0 0-1.6-3.5" />
  </Icon>
);

export const CreditCardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.8" y="5" width="14.4" height="10" rx="2" />
    <path d="M2.8 8.5h14.4" />
  </Icon>
);

export const ServerIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3.5" width="14" height="5" rx="1.6" />
    <rect x="3" y="11.5" width="14" height="5" rx="1.6" />
    <path d="M6 6h.01M6 14h.01" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3.5l7 12.5H3l7-12.5Z" />
    <path d="M10 8v3.2M10 13.6h.01" />
  </Icon>
);

export const ArrowRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 10h11M11 6l4 4-4 4" />
  </Icon>
);

export const ZoomInIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="9" r="5" />
    <path d="M12.8 12.8L16.5 16.5M9 7v4M7 9h4" />
  </Icon>
);

export const ZoomOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="9" r="5" />
    <path d="M12.8 12.8L16.5 16.5M7 9h4" />
  </Icon>
);

export const ExpandIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7.5 3.5h-4v4M12.5 3.5h4v4M7.5 16.5h-4v-4M12.5 16.5h4v-4" />
  </Icon>
);

export const MoreIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5" cy="10" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
);

export const SendIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M17 3.5L9 11M17 3.5l-5.2 13.2-2.6-5.4-5.4-2.6L17 3.5Z" />
  </Icon>
);
