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
    // A photo (Blob) is sent as it is, with its own type; everything else as JSON.
    const isFile = options.body instanceof Blob
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': isFile ? (options.body as Blob).type : 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : isFile ? (options.body as Blob) : JSON.stringify(options.body),
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
