/**
 * Provisional client for the Sucsage deals/files API.
 * Request and response schemas should be tightened once the backend Zod schemas
 * and response payloads are available.
 */

export type JsonObject = Record<string, unknown>;

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function requestJson<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  const response = await fetch(path, init);
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(`API returned an invalid response (${response.status})`, response.status);
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`;
    throw new ApiClientError(message, response.status);
  }

  // Generic response typing is compile-time only; runtime validation belongs to the API/schema layer.
  return payload as TResponse;
}

function postJson<TResponse>(path: string, body: JsonObject): Promise<TResponse> {
  return requestJson<TResponse>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** POST /api/deals — provide a request type when the Zod schema is finalized. */
export function createDeal<TResponse = unknown>(body: JsonObject): Promise<TResponse> {
  return postJson<TResponse>("/api/deals", body);
}

/** GET /api/deals/[id] */
export function getDeal<TResponse = unknown>(id: string | number): Promise<TResponse> {
  return requestJson<TResponse>(`/api/deals/${encodeURIComponent(String(id))}`, {
    method: "GET",
    cache: "no-store",
  });
}

/** POST /api/deals/[id]/action — body shape is intentionally open until its Zod schema is known. */
export function postDealAction<TResponse = unknown>(id: string | number, body: JsonObject): Promise<TResponse> {
  return postJson<TResponse>(`/api/deals/${encodeURIComponent(String(id))}/action`, body);
}

/**
 * POST /api/files — sends an already-encrypted file as multipart form data.
 * Encryption happens before calling this function. The server's field name and
 * response shape should be aligned with its API contract when available.
 */
export function uploadEncryptedFile<TResponse = unknown>(
  encryptedFile: Blob,
  filename: string,
  fieldName = "file",
): Promise<TResponse> {
  const form = new FormData();
  form.append(fieldName, encryptedFile, filename);
  return requestJson<TResponse>("/api/files", { method: "POST", body: form });
}
