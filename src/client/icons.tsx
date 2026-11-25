import React from 'react';
// Small local SVG set so the offline build has no icon-package or CDN dependency.
const paths: Record<string, React.ReactNode> = {
  LayoutGrid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  History: (
    <>
      <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2" />
    </>
  ),
  ShieldCheck: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6" />
    </>
  ),
  ArrowUpRight: <path d="M6 18 18 6M6 6h12v12" />,
  Plus: <path d="M12 5v14M5 12h14" />,
  Upload: <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />,
  UploadCloud: (
    <>
      <path d="M6 16a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 1 11M12 21V10m-4 4 4-4 4 4" />
    </>
  ),
  Search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  ChevronDown: <path d="m6 9 6 6 6-6" />,
  ChevronRight: <path d="m9 6 6 6-6 6" />,
  ArrowRight: <path d="M4 12h16m-6-6 6 6-6 6" />,
  ArrowLeft: <path d="M20 12H4m6-6-6 6 6 6" />,
  FileText: (
    <>
      <path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6" />
    </>
  ),
  GitBranch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 7v10m12-10c0 7-12 3-12 10" />
    </>
  ),
  Clock3: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6h5" />
    </>
  ),
  Download: <path d="M12 3v13m-5-5 5 5 5-5M4 15v6h16v-6" />,
  Share2: (
    <>
      <circle cx="18" cy="4" r="3" />
      <circle cx="5" cy="12" r="3" />
      <circle cx="18" cy="20" r="3" />
      <path d="m8 10 7-4M8 14l7 4" />
    </>
  ),
  LockKeyhole: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  Check: <path d="m5 12 4 4L20 5" />,
  Copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  RefreshCw: <path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5m-4 6a8 8 0 0 0 14 5l3-3m0 5v-5h-5" />,
  X: <path d="m6 6 12 12M18 6 6 18" />,
  BookOpen: <path d="M12 5v16M12 5C9 2 5 3 2 4v15c3-1 7-2 10 2 3-4 7-3 10-2V4c-3-1-7-2-10 1Z" />,
  CheckCircle2: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m7 12 3 3 7-7" />
    </>
  ),
  Menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  LogOut: <path d="M9 4H3v16h6m6-13 5 5-5 5M8 12h12" />,
  Printer: (
    <>
      <path d="M7 8V3h10v5M6 17H3V8h18v9h-3M7 14h10v7H7z" />
    </>
  ),
  Folder: <path d="M3 6h7l2 3h9v12H3V6Zm0 0V3h7l3 3h8v3" />,
  Info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v7M12 7h.01" />
    </>
  ),
  GitCompareArrows: <path d="M5 3v16m-3-3 3 3 3-3M19 21V5m-3 3 3-3 3 3M9 5h4v5h-2M15 19h-4v-5h2" />,
};
function icon(name: string) {
  return function Icon({
    size = 24,
    strokeWidth = 1.8,
    ...props
  }: React.SVGProps<SVGSVGElement> & {size?: number; strokeWidth?: number}) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths[name]}
      </svg>
    );
  };
}
export const LayoutGrid = icon('LayoutGrid'),
  History = icon('History'),
  ShieldCheck = icon('ShieldCheck'),
  ArrowUpRight = icon('ArrowUpRight'),
  Plus = icon('Plus'),
  Upload = icon('Upload'),
  UploadCloud = icon('UploadCloud'),
  Search = icon('Search'),
  ChevronDown = icon('ChevronDown'),
  ChevronRight = icon('ChevronRight'),
  ArrowRight = icon('ArrowRight'),
  ArrowLeft = icon('ArrowLeft'),
  FileText = icon('FileText'),
  GitBranch = icon('GitBranch'),
  Clock3 = icon('Clock3'),
  Download = icon('Download'),
  Share2 = icon('Share2'),
  LockKeyhole = icon('LockKeyhole'),
  Check = icon('Check'),
  Copy = icon('Copy'),
  RefreshCw = icon('RefreshCw'),
  X = icon('X'),
  BookOpen = icon('BookOpen'),
  CheckCircle2 = icon('CheckCircle2'),
  Menu = icon('Menu'),
  LogOut = icon('LogOut'),
  Printer = icon('Printer'),
  Folder = icon('Folder'),
  Info = icon('Info'),
  GitCompareArrows = icon('GitCompareArrows');
