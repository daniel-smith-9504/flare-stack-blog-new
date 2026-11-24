/**
 * The shape xxapi.cn wraps its answers in: a status `code`, an optional
 * `data` payload and an optional `msg`. The public APIs are untyped, so each
 * caller names the payload it expects.
 */
export interface XxapiEnvelope<T> {
  code?: number | string;
  data?: T;
  msg?: string;
}

export function readXxapi<T>(response: Response): Promise<XxapiEnvelope<T>> {
  return response.json() as Promise<XxapiEnvelope<T>>;
}

/** The /api/uapis route passes the upstream body through unchanged. */
export function readProxy<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
