import mark from "../../assets/stablealt-mark.svg";

type Props = {
  size?: number;
  className?: string;
};

/** The StableAlt brand mark. Decorative — every use sits next to the name. */
export function LogoMark({ size = 36, className }: Props) {
  return (
    <img
      className={className ? `logo-mark ${className}` : "logo-mark"}
      src={mark}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      alt=""
      draggable={false}
    />
  );
}
