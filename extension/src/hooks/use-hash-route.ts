import { useEffect, useState } from "react";

/** Tiny hash router - extension pages have no server for history routing. */
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
