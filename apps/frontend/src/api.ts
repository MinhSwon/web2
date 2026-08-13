const API_ROOT = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload.error ?? "REQUEST_FAILED");
  return payload as T;
}

export async function streamJob(
  jobId: string,
  token: string,
  onMessage: (value: Job) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`${API_ROOT}/api/jobs/${jobId}/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok || !response.body) throw new ApiError(response.status, "STREAM_FAILED");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (data) onMessage(JSON.parse(data.slice(6)) as Job);
    }
  }
}

export type User = { id: string; email: string; display_name: string; role: string; credits: number };
export type Project = {
  id: string;
  title: string;
  topic?: string;
  status: string;
  asset_count?: number;
  latest_job?: Job | null;
};
export type Asset = { id: string; file_name: string; content_type: string; size_bytes: number };
export type Job = {
  id: string;
  status: "PENDING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELED";
  progress: number;
  stage: string;
  message?: string;
  error_code?: string;
  download_url?: string | null;
};

