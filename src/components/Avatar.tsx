import { useState } from "react";

type Props = {
  name: string;
  url: string | null;
  large?: boolean;
};

export function Avatar({ name, url, large = false }: Props) {
  const [broken, setBroken] = useState(false);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  if (url && !broken) {
    return (
      <img
        className={large ? "avatar lg" : "avatar"}
        src={url}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className={large ? "avatar lg" : "avatar"} aria-hidden="true">
      {initials}
    </div>
  );
}
