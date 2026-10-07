/**
 * Siri-like light inside a container while something is live: an aura pooling
 * at the bottom and a spectral edge flowing around the lower rim. The parent
 * needs `position: relative`, a border radius and `overflow: hidden`.
 */
export function LiveGlow({ quiet = false }: { quiet?: boolean }) {
  return (
    <>
      <span className={`liquid-aura ${quiet ? 'is-quiet' : 'is-live'}`} aria-hidden />
      {!quiet && <span className="aura-edge" aria-hidden />}
    </>
  );
}
