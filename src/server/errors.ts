export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export const badRequest = (message: string): ApiError => new ApiError(400, "bad_request", message)
export const unauthorized = (): ApiError => new ApiError(401, "unauthorized", "missing or invalid server token")
export const notFound = (message: string): ApiError => new ApiError(404, "not_found", message)
export const conflict = (message: string): ApiError => new ApiError(409, "conflict", message)
