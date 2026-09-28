import type { ContentRequest } from "@/lib/messages";
import type { TabState } from "@/lib/types";

type Response<T> = { ok: true; result: T } | { ok: false; error: string };

export async function request<T = unknown>(message: ContentRequest): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as Response<T> | undefined;
  if (!response) throw new Error("Keine Antwort vom Hintergrunddienst");
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

export async function hello(): Promise<TabState | null> {
  try {
    return await request<TabState | null>({ type: "qey:hello" });
  } catch {
    return null;
  }
}
