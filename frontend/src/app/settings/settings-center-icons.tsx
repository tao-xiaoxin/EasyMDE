import { createElement } from '@wordpress/element';
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function SvgIcon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round"
      strokeLinejoin="round" {...props}>{children}</svg>
  );
}

export function GeneralIcon(props: IconProps) {
  return <SvgIcon {...props}><circle cx="12" cy="12" r="3.15"/><path d="M19.2 13.2a7.8 7.8 0 0 0 .05-2.35l2.05-1.55-2-3.45-2.48 1a8.2 8.2 0 0 0-2.02-1.18L14.45 3h-4l-.38 2.67a8.1 8.1 0 0 0-2.02 1.18l-2.48-1-2 3.45 2.05 1.55a7.8 7.8 0 0 0 .05 2.35L3.6 14.8l2 3.45 2.42-1a8.4 8.4 0 0 0 2.05 1.2l.38 2.55h4l.35-2.55a8.3 8.3 0 0 0 2.05-1.2l2.42 1 2-3.45-2.07-1.6Z"/></SvgIcon>;
}

export function KeyboardIcon(props: IconProps) {
  return <SvgIcon {...props}><rect x="3" y="5.2" width="18" height="13.6" rx="2.2"/><path d="M6.4 9h.01M9.9 9h.01M13.4 9h.01M16.9 9h.01M6.4 12.2h.01M9.9 12.2h.01M13.4 12.2h.01M16.9 12.2h.01M6.4 15.4h.01M10 15.4h5.8"/></SvgIcon>;
}

export function ImageLibraryIcon(props: IconProps) {
  return <SvgIcon {...props}><rect x="3" y="3.3" width="17.6" height="17.4" rx="2.3"/><circle cx="8.1" cy="8.2" r="1.55"/><path d="m4.3 17 4.45-4.7 3.25 3.05 2.4-2.5 4.15 3.95"/></SvgIcon>;
}

export function AiSparkIcon(props: IconProps) {
  return <SvgIcon {...props}><path d="M12.4 2.4c.42 3.55 2.02 5.15 5.58 5.58-3.56.43-5.16 2.03-5.58 5.58-.43-3.55-2.03-5.15-5.58-5.58 3.55-.43 5.15-2.03 5.58-5.58Z"/><path d="M18.2 13.15c.3 2.35 1.32 3.4 3.58 3.7-2.26.3-3.28 1.34-3.58 3.7-.3-2.36-1.32-3.4-3.58-3.7 2.26-.3 3.28-1.35 3.58-3.7ZM5.05 13.55c.24 1.85 1.05 2.68 2.82 2.93-1.77.25-2.58 1.08-2.82 2.93-.24-1.85-1.05-2.68-2.82-2.93 1.77-.25 2.58-1.08 2.82-2.93Z"/></SvgIcon>;
}

export function MarkdownIcon(props: IconProps) {
  return <SvgIcon {...props}><rect x="2.5" y="4.1" width="19" height="15.8" rx="2.3"/><path d="M5.4 15.4V8.7l3.15 3.25L11.7 8.7v6.7M16.7 8.8v6.3M14.6 13l2.1 2.1 2.1-2.1"/></SvgIcon>;
}

export function ArticleSyncIcon(props: IconProps) {
  return <SvgIcon {...props}><path d="M7.4 17.8H6.2a4.2 4.2 0 0 1-.65-8.35A6.5 6.5 0 0 1 18 7.7a4.4 4.4 0 0 1 .15 8.8h-1.4"/><path d="M9 14.4a3.8 3.8 0 0 1 6.45 1.05M15.45 15.45v-2.2h2.2M15 19.6a3.8 3.8 0 0 1-6.45-1.05M8.55 18.55v2.2h-2.2"/></SvgIcon>;
}

export function ImportExportIcon(props: IconProps) {
  return <SvgIcon {...props}><path d="M7.1 5.1A8.3 8.3 0 0 1 12 3.5h1.2M11.2 1.7l2 1.8-2 1.8M18.9 7.1A8.3 8.3 0 0 1 20.5 12v1.2M22.3 11.2l-1.8 2-1.8-2M16.9 18.9A8.3 8.3 0 0 1 12 20.5h-1.2M12.8 22.3l-2-1.8 2-1.8M5.1 16.9A8.3 8.3 0 0 1 3.5 12v-1.2M1.7 12.8l1.8-2 1.8 2"/></SvgIcon>;
}

export function AboutIcon(props: IconProps) {
  return <SvgIcon {...props}><circle cx="12" cy="12" r="9.2"/><path d="M12 10.7v6M12 7.3h.01"/></SvgIcon>;
}

export function SlidersIcon(props: IconProps) {
  return <SvgIcon {...props}><path d="M1.5 4h21.2M1.5 12h21.2M1.5 20h21.2"/><circle cx="9.3" cy="4" r="2.2" fill="white"/><circle cx="18" cy="12" r="2.2" fill="white"/><circle cx="9.3" cy="20" r="2.2" fill="white"/></SvgIcon>;
}

export function EditPencilIcon(props: IconProps) {
  return <SvgIcon {...props}><path d="m4 16.8-.7 5.1 3.9-1.95L19.5 7.65a2.25 2.25 0 0 0 0-3.2 2.25 2.25 0 0 0-3.2 0L4 16.8Z"/><path d="m14.8 5.95 3.25 3.25"/></SvgIcon>;
}

export function DocumentIcon(props: IconProps) {
  return <SvgIcon {...props} strokeWidth={1.65}><path d="M2.2 1.3h12L19 6.1v14.4H2.2z"/><path d="M14 1.3v5h5M8 11.8h6M8 15.8h6"/></SvgIcon>;
}

export function SearchIcon(props: IconProps) {
  return <SvgIcon {...props}><circle cx="10.7" cy="10.7" r="6.2"/><path d="m15.2 15.2 4.4 4.4"/></SvgIcon>;
}
