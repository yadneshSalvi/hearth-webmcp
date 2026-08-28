interface GraphQLIssue {
  message: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

interface GraphQLPayload<T> {
  data?: T;
  errors?: GraphQLIssue[];
  extensions?: Record<string, unknown>;
}

export class AdminGraphQLError extends Error {
  readonly status?: number;
  readonly issues: GraphQLIssue[];

  constructor(message: string, options: { status?: number; issues?: GraphQLIssue[] } = {}) {
    super(message);
    this.name = "AdminGraphQLError";
    this.status = options.status;
    this.issues = options.issues ?? [];
  }
}

export interface AdminConfig {
  domain: string;
  version: string;
  token: string;
}

let throttleUntil = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function scheduleCostThrottle(extensions: Record<string, unknown> | undefined): void {
  const cost = extensions?.cost;
  if (!isRecord(cost)) return;
  const status = cost.throttleStatus;
  if (!isRecord(status)) return;
  const available = numberField(status, "currentlyAvailable");
  const restoreRate = numberField(status, "restoreRate");
  const actual = numberField(cost, "actualQueryCost") ?? numberField(cost, "requestedQueryCost") ?? 50;
  if (available === undefined || !restoreRate || available >= actual + 25) return;
  const waitMs = Math.ceil(((actual + 25 - available) / restoreRate) * 1_000);
  throttleUntil = Math.max(throttleUntil, Date.now() + waitMs);
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

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function awaitThrottle(): Promise<void> {
  await delay(Math.max(0, throttleUntil - Date.now()));
}

export function adminConfig(): AdminConfig {
  if (!process.env.SHOPIFY_ADMIN_TOKEN) {
    try {
      process.loadEnvFile();
    } catch {
      // CI and production inject environment variables without a local .env file.
    }
  }
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !version || !token) {
    throw new AdminGraphQLError("Missing Shopify Admin configuration");
  }
  return { domain, version, token };
}

export async function adminGraphql<TData, TVariables extends object = Record<string, never>>(
  document: string,
  variables: TVariables = {} as TVariables,
): Promise<TData> {
  const config = adminConfig();
  const endpoint = `https://${config.domain}/admin/api/${config.version}/graphql.json`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await awaitThrottle();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": config.token,
        },
        body: JSON.stringify({ query: document, variables }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (attempt < 3) {
        await delay(500 * (2 ** attempt));
        continue;
      }
      throw new AdminGraphQLError(error instanceof Error && error.name === "TimeoutError"
        ? "Shopify Admin request timed out"
        : "Shopify Admin network request failed");
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < 3) {
        await delay(retryAfterMs(response, attempt));
        continue;
      }
      throw new AdminGraphQLError(`Shopify Admin returned HTTP ${response.status}`, { status: response.status });
    }
    if (!response.ok) {
      throw new AdminGraphQLError(`Shopify Admin returned HTTP ${response.status}`, { status: response.status });
    }

    let payload: GraphQLPayload<TData>;
    try {
      payload = await response.json() as GraphQLPayload<TData>;
    } catch {
      throw new AdminGraphQLError("Shopify Admin returned invalid JSON");
    }
    scheduleCostThrottle(payload.extensions);
    if (payload.errors?.length) {
      throw new AdminGraphQLError("Shopify Admin returned GraphQL errors", { issues: payload.errors });
    }
    if (payload.data === undefined) throw new AdminGraphQLError("Shopify Admin response omitted data");
    return payload.data;
  }
  throw new AdminGraphQLError("Shopify Admin is unavailable");
}
