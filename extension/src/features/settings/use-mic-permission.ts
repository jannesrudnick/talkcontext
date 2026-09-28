import { useCallback, useEffect, useState } from "react";

export type MicPermission = "granted" | "denied" | "prompt" | "unknown";

/**
 * Mikrofon-Freigabe fuer die Origin der Extension. Das Offscreen-Dokument kann
 * selbst nicht nachfragen - deshalb wird sie hier, auf einer sichtbaren Seite,
 * einmalig eingeholt.
 */
export function useMicPermission() {
  const [state, setState] = useState<MicPermission>("unknown");

  useEffect(() => {
    let status: PermissionStatus | null = null;
    const update = () => status && setState(status.state as MicPermission);
    void navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((result) => {
        status = result;
        update();
        result.addEventListener("change", update);
      })
      .catch(() => setState("unknown"));
    return () => status?.removeEventListener("change", update);
  }, []);

  const request = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setState("granted");
      return true;
    } catch {
      setState("denied");
      return false;
    }
  }, []);

  return { state, request };
}
