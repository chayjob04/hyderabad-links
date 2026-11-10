// Server-side only. The browser never calls the API: server components and server actions do.
//
// The one HTTP helper both signed-in clients use. There are two of them now — `owner-api.ts` for
// business owners and `customer-api.ts` for customers — and they attach different tokens from
// different cookies, but the way a request is sent and a failure is read is the same. Keeping one
// copy means an error message or a timeout rule cannot end up different on one side.

import { API_BASE_URL } from "./api-base";

export type ApiFailure = { ok: false; status: number; message: string; fieldErrors: Record<string, string> };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

export async function toFailure(response: Response): Promise<ApiFailure> {
  let message = "Something went wrong. Please try again.";
  const fieldErrors: Record<string, string> = {};
  try {
    const body = (await response.json()) as { detail?: unknown; errors?: Record<string, unknown> };
    if (body.errors && typeof body.errors === "object") {
      for (const [field, messages] of Object.entries(body.errors)) {
        if (Array.isArray(messages) && typeof messages[0] === "string") fieldErrors[field] = messages[0];
      }
      message = "Please fix the fields marked below.";
    } else if (typeof body.detail === "string") {
      message = body.detail;
    }
  } catch {
    // Not JSON: keep the generic message.
  }
  return { ok: false, status: response.status, message, fieldErrors };
}

export async function send<T>(path: string, init: RequestInit, accessToken?: string): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    return { ok: false, status: 0, message: "We could not reach the server. Please try again in a moment.", fieldErrors: {} };
  }
  if (!response.ok) return toFailure(response);
  if (response.status === 204) return { ok: true, data: undefined as T };
  return { ok: true, data: (await response.json()) as T };
}

export const json = (value: unknown): string => JSON.stringify(value);
