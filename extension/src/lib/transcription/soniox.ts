/** Soniox real-time models - `latest` resolves to the newest one when the recording starts. */
export const SONIOX_LATEST = "latest";
/** Used when the model list can't be loaded. */
export const SONIOX_FALLBACK_MODEL = "stt-rt-v5";
export const SONIOX_ASYNC_FALLBACK_MODEL = "stt-async-v6";

const version = (id: string) => Number(/-v(\d+)/.exec(id)?.[1] ?? 0);

/** Model ids for a mode, newest first (highest `-vN`, previews after stable). */
export async function listSonioxModels(apiKey: string, mode: "real_time" | "async" = "real_time"): Promise<string[]> {
  const response = await fetch("https://api.soniox.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Soniox models: HTTP ${response.status}`);
  const { models } = (await response.json()) as { models: Array<{ id: string; transcription_mode?: string }> };
  return models
    .filter((model) => model.transcription_mode === mode)
    .map((model) => model.id)
    .sort((a, b) => version(b) - version(a) || Number(a.includes("preview")) - Number(b.includes("preview")));
}

export async function resolveSonioxModel(apiKey: string, model: string): Promise<string> {
  if (model && model !== SONIOX_LATEST) return model;
  try {
    return (await listSonioxModels(apiKey))[0] ?? SONIOX_FALLBACK_MODEL;
  } catch {
    return SONIOX_FALLBACK_MODEL;
  }
}
