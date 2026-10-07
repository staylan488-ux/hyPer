import { useId, type ReactElement, type ReactNode, type SVGProps } from 'react';

/**
 * The web tab bar's glyphs, drawn on one 24px grid at one 1.6px stroke, each
 * with a filled variant for the selected tab (as SF Symbols' `.fill`). The
 * dumbbell is upright and plain so it carries no more detail than the house,
 * leaf and person beside it.
 */
export interface TabIconProps extends Omit<SVGProps<SVGSVGElement>, 'fill'> {
  filled?: boolean;
}

function Glyph({ filled: _filled, children, ...props }: TabIconProps & { children: ReactNode }) {
  void _filled;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeGlyph(props: TabIconProps): ReactElement {
  const filled = Boolean(props.filled);
  return (
    <Glyph {...props}>
      <path d="M3.5 10.2 12 3.3l8.5 6.9v9.3a1.2 1.2 0 0 1-1.2 1.2H15v-6.2H9v6.2H4.7a1.2 1.2 0 0 1-1.2-1.2z" fill={filled ? 'currentColor' : 'none'} />
    </Glyph>
  );
}

export function DumbbellGlyph(props: TabIconProps): ReactElement {
  const filled = Boolean(props.filled);
  return (
    <Glyph {...props}>
      <>
        <path d="M8 12h8" />
        <rect x="5" y="7" width="3" height="10" rx="1.2" fill={filled ? 'currentColor' : 'none'} />
        <rect x="16" y="7" width="3" height="10" rx="1.2" fill={filled ? 'currentColor' : 'none'} />
        <path d="M2.8 10v4M21.2 10v4" />
      </>
    </Glyph>
  );
}

export function LeafGlyph(props: TabIconProps): ReactElement {
  const filled = Boolean(props.filled);
  const cut = `leaf-vein${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const leaf = 'M5 19.5C4.6 10.6 9.4 4.7 19.6 4.4c.4 10.2-5.6 15.2-14.6 15.1z';
  const vein = 'M5 19.5 13.5 11';
  return (
    <Glyph {...props}>
      {filled ? (
        <>
          {/* Filled, the vein is cut out of the leaf. */}
          <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <rect width="24" height="24" fill="#fff" />
            <path d={vein} stroke="#000" />
          </mask>
          <path d={leaf} fill="currentColor" mask={`url(#${cut})`} />
        </>
      ) : (
        <>
          <path d={leaf} />
          <path d={vein} />
        </>
      )}
    </Glyph>
  );
}

export function PersonGlyph(props: TabIconProps): ReactElement {
  const filled = Boolean(props.filled);
  return (
    <Glyph {...props}>
      <>
        <circle cx="12" cy="8" r="4" fill={filled ? 'currentColor' : 'none'} />
        <path d="M4.5 20.5c.6-3.9 3.6-6.3 7.5-6.3s6.9 2.4 7.5 6.3z" fill={filled ? 'currentColor' : 'none'} />
      </>
    </Glyph>
  );
}
