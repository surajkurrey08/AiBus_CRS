import { ApiError } from "./ApiError.ts";
export async function readApiResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  let body: any;
  try {
    body = await response.json();
  } catch {
    if ([502, 503, 504, 500].includes(response.status))
      throw new ApiError(
        response.status,
        "BACKEND_UNAVAILABLE",
        "The operator API is not running or could not be reached. Start the backend with MongoDB and Redis, then try again.",
      );
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      contentType.includes("text/html")
        ? "The API request returned a web page. Check the frontend API proxy configuration."
        : "The API returned an invalid response. Please retry or contact your administrator.",
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error?.code || "REQUEST_FAILED",
      body?.error?.message || "Request failed",
    );
  if (
    !body ||
    typeof body !== "object" ||
    !Object.prototype.hasOwnProperty.call(body, "data")
  )
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "The API response is missing its data envelope. Check the backend API configuration.",
    );
  return body;
}
