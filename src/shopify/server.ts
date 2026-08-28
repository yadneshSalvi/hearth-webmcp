import "server-only";

interface GraphQLIssue {
  message: string;
  path?: Array<string | number>;
}

interface GraphQLPayload<T> {
  data?: T;
  errors?: GraphQLIssue[];
}

export class GraphQLError extends Error {
  readonly issues: GraphQLIssue[];

  constructor(message: string, issues: GraphQLIssue[] = []) {
    super(message);
    this.name = "GraphQLError";
    this.issues = issues;
  }
}

export type StorefrontResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "unavailable"; detail: string };

function firstBuyerIp(request?: Request): string | undefined {
  if (!request) return undefined;
  const candidate = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")?.trim();
  return candidate && /^[0-9a-f.:]{3,64}$/i.test(candidate) ? candidate : undefined;
}

function retryDelay(response: Response): number {
  const value = response.headers.get("retry-after");
  if (!value) return 250;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(1_000, Math.max(0, seconds * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(1_000, Math.max(0, date - Date.now())) : 250;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function execute<TData, TVariables extends object>(
  document: string,
  variables: TVariables,
  request?: Request,
): Promise<TData> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION;
  const privateToken = process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN;
  const publicToken = process.env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN;
  if (!domain || !version || (!privateToken && !publicToken)) {
    throw new GraphQLError("Shopify Storefront configuration is incomplete");
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  if (privateToken) {
    headers.set("Shopify-Storefront-Private-Token", privateToken);
    const ip = firstBuyerIp(request);
    if (ip) headers.set("Shopify-Storefront-Buyer-IP", ip);
  } else if (publicToken) {
    headers.set("X-Shopify-Storefront-Access-Token", publicToken);
  }

  const endpoint = `https://${domain}/api/${version}/graphql.json`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: document, variables }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (attempt === 0) continue;
      throw new GraphQLError(error instanceof Error && error.name === "TimeoutError"
        ? "Shopify Storefront request timed out"
        : "Shopify Storefront network request failed");
    }

    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await delay(retryDelay(response));
      continue;
    }
    if (!response.ok) throw new GraphQLError(`Shopify Storefront returned HTTP ${response.status}`);

    let payload: GraphQLPayload<TData>;
    try {
      payload = await response.json() as GraphQLPayload<TData>;
    } catch {
      throw new GraphQLError("Shopify Storefront returned invalid JSON");
    }
    if (payload.errors?.length) {
      throw new GraphQLError("Shopify Storefront returned GraphQL errors", payload.errors);
    }
    if (payload.data === undefined) throw new GraphQLError("Shopify Storefront response omitted data");
    return payload.data;
  }
  throw new GraphQLError("Shopify Storefront is unavailable");
}

export async function storefrontFetch<TData, TVariables extends object>(
  document: string,
  variables: TVariables,
  request?: Request,
): Promise<StorefrontResult<TData>> {
  try {
    return { ok: true, data: await execute<TData, TVariables>(document, variables, request) };
  } catch (error) {
    const detail = error instanceof GraphQLError ? error.message : "Shopify Storefront is unavailable";
    return { ok: false, error: "unavailable", detail };
  }
}
