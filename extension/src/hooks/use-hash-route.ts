import { useEffect, useState } from "react";

/** Winziger Hash-Router - Extension-Seiten haben keinen Server fuer History-Routing. */
export function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [segments, setSegments] = useState(read);
  useEffect(() => {
    const onChange = () => setSegments(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return segments;
}

export function navigate(path: string) {
  window.location.hash = `#/${path.replace(/^\//, "")}`;
}
