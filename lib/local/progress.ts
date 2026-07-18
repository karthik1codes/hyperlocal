export type ResearchStepId =
  | "connect"
  | "search"
  | "pick"
  | "open"
  | "extract"
  | "gemini"
  | "tts"
  | "card"
  | "store"
  | "done"
  | "error"
  | "wait";

export type ResearchProgressEvent = {
  step: ResearchStepId;
  label: string;
  detail?: string;
  at: number;
};

export type ResearchProgress = (event: Omit<ResearchProgressEvent, "at">) => void;

export function emitProgress(
  onProgress: ResearchProgress | undefined,
  step: ResearchStepId,
  label: string,
  detail?: string,
) {
  onProgress?.({ step, label, detail });
}
