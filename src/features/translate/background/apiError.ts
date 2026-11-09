import { t } from "@shared/i18n";
import { trimErrorText } from "@shared/util";

export interface ApiError extends Error {
  status?: number;
  retryAfter?: string | null;
  retryable?: boolean;
}

export interface ParsedApiError {
  message: string;
  type: string;
  raw: string;
}

/** Redact API keys and bearer tokens from any text before it reaches the user. */
export function sanitizeSecrets(text: string, apiKey?: string): string {
  let out = String(text ?? "");
  if (apiKey && apiKey.length >= 6) {
    out = out.split(apiKey).join("[redacted]");
  }
  out = out.replace(/Bearer\s+[\w.\-]+/gi, "Bearer [redacted]");
  out = out.replace(/sk-[A-Za-z0-9_\-]{6,}/g, "sk-[redacted]");
  return out;
}

export async function readApiError(response: Response): Promise<ParsedApiError> {
  const text = await response.text().catch(() => "");
  if (!text) return { message: "", type: "", raw: "" };
  try {
    const parsed = JSON.parse(text);
    const payload = parsed.error || parsed;
    return {
      message: String(payload.message || payload.error || trimErrorText(text)),
      type: String(payload.type || payload.code || ""),
      raw: trimErrorText(text),
    };
  } catch {
    return { message: trimErrorText(text), type: "", raw: trimErrorText(text) };
  }
}

function isKimiCodingAccessError(apiError: ParsedApiError, endpoint: string): boolean {
  const blob = `${apiError.message} ${apiError.type} ${endpoint}`.toLowerCase();
  return (
    blob.includes("kimi for coding") ||
    blob.includes("access_terminated_error") ||
    blob.includes("api.kimi.com/coding")
  );
}

export function formatApiError(
  status: number,
  apiError: ParsedApiError,
  endpoint: string,
  apiKey?: string,
): string {
  if (isKimiCodingAccessError(apiError, endpoint)) {
    return t("errKimiCoding") !== "errKimiCoding"
      ? t("errKimiCoding")
      : "This endpoint/model is Kimi Code (coding agents only). Use the Moonshot Open Platform base URL (e.g. https://api.moonshot.cn/v1) and a matching key.";
  }
  const detail = sanitizeSecrets(apiError.message || apiError.raw, apiKey);
  return `HTTP ${status}${detail ? ` — ${detail}` : ""}`;
}

/** Build a rich Error (with status/retryAfter) from a non-OK response. */
export async function toApiError(response: Response, endpoint: string, apiKey?: string): Promise<ApiError> {
  const parsed = await readApiError(response);
  const error = new Error(formatApiError(response.status, parsed, endpoint, apiKey)) as ApiError;
  error.status = response.status;
  error.retryAfter = response.headers.get("retry-after");
  return error;
}
