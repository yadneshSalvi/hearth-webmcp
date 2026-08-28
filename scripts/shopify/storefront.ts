interface StorefrontIssue {
  message: string;
  path?: Array<string | number>;
}

interface StorefrontPayload<T> {
  data?: T;
  errors?: StorefrontIssue[];
}

export class StorefrontGraphQLError extends Error {
  readonly status?: number;
  readonly issues: StorefrontIssue[];

  constructor(message: string, options: { status?: number; issues?: StorefrontIssue[] } = {}) {
    super(message);
    this.name = "StorefrontGraphQLError";
    this.status = options.status;
    this.issues = options.issues ?? [];
  }
}

export interface StorefrontConfig {
  domain: string;
  version: string;
  token: string;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(60_000, Math.max(0, seconds * 1_000));
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(60_000, Math.max(0, date - Date.now()));
  }
  return Math.min(8_000, 500 * (2 ** attempt));
}

export function storefrontConfig(): StorefrontConfig {
  if (!process.env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN) {
    try {
      process.loadEnvFile();
    } catch {
      // CI and production inject environment variables without a local .env file.
    }
  }
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION;
  const token = process.env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN;
  if (!domain || !version || !token) {
    throw new StorefrontGraphQLError("Missing Shopify Storefront public configuration");
  }
  return { domain, version, token };
}

export async function storefrontGraphql<TData, TVariables extends object = Record<string, never>>(
  document: string,
  variables: TVariables = {} as TVariables,
): Promise<TData> {
  const config = storefrontConfig();
  const endpoint = `https://${config.domain}/api/${config.version}/graphql.json`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": config.token,
        },
        body: JSON.stringify({ query: document, variables }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (attempt < 3) {
        await delay(500 * (2 ** attempt));
        continue;
      }
      throw new StorefrontGraphQLError(error instanceof Error && error.name === "TimeoutError"
        ? "Shopify Storefront request timed out"
        : "Shopify Storefront network request failed");
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < 3) {
        await delay(retryAfterMs(response, attempt));
        continue;
      }
      throw new StorefrontGraphQLError(`Shopify Storefront returned HTTP ${response.status}`, { status: response.status });
    }
    if (!response.ok) {
      throw new StorefrontGraphQLError(`Shopify Storefront returned HTTP ${response.status}`, { status: response.status });
    }

    let payload: StorefrontPayload<TData>;
    try {
      payload = await response.json() as StorefrontPayload<TData>;
    } catch {
      throw new StorefrontGraphQLError("Shopify Storefront returned invalid JSON");
    }
    if (payload.errors?.length) {
      throw new StorefrontGraphQLError("Shopify Storefront returned GraphQL errors", { issues: payload.errors });
    }
    if (payload.data === undefined) throw new StorefrontGraphQLError("Shopify Storefront response omitted data");
    return payload.data;
  }
  throw new StorefrontGraphQLError("Shopify Storefront is unavailable");
}
