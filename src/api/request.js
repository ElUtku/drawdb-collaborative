export const UNAUTHORIZED_EVENT = "drawdb:unauthorized";

/**
 * Shared JSON fetch wrapper. A 401 on any call other than the ones that probe
 * the session itself means the session went away, so the app is told to send
 * the user back to the login screen.
 */
export async function request(url, { skipUnauthorizedEvent, ...options } = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  if (response.status === 401 && !skipUnauthorizedEvent) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      body.error || `Request failed (${response.status})`,
    );
    error.status = response.status;
    error.diagram = body.diagram;
    throw error;
  }
  return body;
}
