/** Typed provider failure. Preserves the HTTP detail in the message. */
export class ProviderError extends Error {
  readonly provider: string
  readonly status?: number
  readonly code: string
  readonly retryable: boolean
  readonly body?: string

  constructor(
    provider: string,
    options: { status?: number; body?: string; code?: string; retryable?: boolean; message?: string } = {},
  ) {
    const body = options.body?.slice(0, 500)
    const message =
      options.message ??
      (options.status ? `${provider}: HTTP ${options.status}${body ? `: ${body}` : ""}` : `${provider}: request failed`)
    super(message)
    this.name = "ProviderError"
    this.provider = provider
    this.status = options.status
    this.code = options.code ?? codeForStatus(options.status)
    this.retryable = options.retryable ?? (options.status === 429 || (options.status ?? 0) >= 500)
    this.body = body
  }
}

function codeForStatus(status?: number): string {
  if (!status) return "network_error"
  if (status === 401) return "authentication_error"
  if (status === 403) return "permission_error"
  if (status === 404) return "not_found"
  if (status === 429) return "rate_limit"
  if (status >= 500) return "server_error"
  if (status >= 400) return "invalid_request"
  return "provider_error"
}
