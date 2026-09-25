// One place for every call to our API. The session cookie is sent automatically
// because the website and API share one address (see vite.config.ts proxy).

export class ApiError extends Error {
  status: number
  fields: Record<string, string>
  data: Record<string, any>

  constructor(status: number, message: string, fields: Record<string, string> = {}, data: Record<string, any> = {}) {
    super(message)
    this.status = status
    this.fields = fields
    this.data = data
  }
}

interface ApiOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, "Can't reach KurumanMarketPlace. Check your internet connection and try again.")
  }

  if (res.status === 204) return undefined as T

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? 'Something went wrong. Please try again.', data.fields, data)
  }
  return data as T
}
