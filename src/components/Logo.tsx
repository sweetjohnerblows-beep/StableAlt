type Props = {
  size?: number;
  className?: string;
};

/**
 * The StableAlt mark: a solid archway with the doorway lit in the accent.
 *
 * Filled rather than stroked, so it keeps a silhouette at 20px in the bar and
 * still reads as an emblem at 512px in a store listing. One way in, however
 * many accounts go through it — the shape is an archway, which shares no
 * geometry with the rotated tile-and-cutout marks used elsewhere in this space.
 *
 * The doorway is deliberately tall and narrow: a wide one fills the arch and
 * the whole mark reads as a padlock body instead of a way through.
 *
 * Drawn inline rather than as a file so the wall takes the colour of the surface
 * it sits on (`currentColor`) and the doorway takes the active theme's accent.
 * The default Steel theme gives an ink arch and a violet door.
 */
export function LogoMark({ size = 36, className }: Props) {
  return (
    <svg
      className={className ? `logo-mark ${className}` : "logo-mark"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* The wall: solid, open at the threshold. */}
      <path className="logo-arch" d="M3.4 21.2V12.6a8.6 8.6 0 0 1 17.2 0v8.6Z" />
      {/* The way through, sunk in the accent. */}
      <path className="logo-door" d="M8.7 21.2V14.2a3.3 3.3 0 0 1 6.6 0v7Z" />
    </svg>
  );
}
