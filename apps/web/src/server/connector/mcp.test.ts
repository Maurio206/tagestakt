// @vitest-environment node
/**
 * MCP-Oberfläche mit dem offiziellen Client-SDK gegen den echten Endpunkt (`handleMcpHttp`):
 * Handshake beider Protokoll-Generationen, Bearer-Pflicht, Host-/Origin-Prüfung, Tool-Liste,
 * strenge Eingabeschemas, Scope-Trennung und Identität ausschließlich aus dem Token. Die
 * Fachlogik (Datenbank) ist hier gemockt; sie wird in den Datenbank-E2E-Tests geprüft.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PlanningService from "./planning-service";
import { type ConnectorScope } from "./scopes";

const OWNER = "11111111-1111-4111-8111-111111111111";
const GRANT = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const ACCESS = `tt_at_${"A".repeat(43)}`;
const READ_ONLY = `tt_at_${"B".repeat(43)}`;
const DRAFT_ONLY = `tt_at_${"D".repeat(43)}`;
const MCP_URL = "https://plan.tagestakt.test/mcp";

const store = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(),
}));
const service = vi.hoisted(() => ({
  getPlanningContext: vi.fn(),
  getActivityHistory: vi.fn(),
  validateWeekPlan: vi.fn(),
  saveWeekDraft: vi.fn(),
  getWeekDraft: vi.fn(),
  publishWeekDraft: vi.fn(),
  discardWeekDraft: vi.fn(),
}));
vi.mock("./oauth-store", () => store);
vi.mock("./planning-service", async (importOriginal) => ({
  ...(await importOriginal<typeof PlanningService>()),
  ...service,
}));

const { handleMcpHttp } = await import("./http");
const { resetConnectorConfigForTests } = await import("./config");

function access(scopes: ConnectorScope[]) {
  return {
    ownerId: OWNER,
    grantId: GRANT,
    clientId: "https://claude.ai/oauth/mcp-client-metadata",
    scopes,
    resource: MCP_URL,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

const serverFetch = async (url: string | URL, init?: RequestInit) =>
  handleMcpHttp(
    new Request(url, { ...init, headers: { host: "plan.tagestakt.test", ...headersOf(init) } }),
  );

function headersOf(init?: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

async function connect(token: string, mode: "legacy" | "auto" = "auto") {
  const client = new Client(
    { name: "tagestakt-test", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: serverFetch,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

function text(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return JSON.parse(content.find((c) => c.type === "text")?.text ?? "{}") as Record<
    string,
    unknown
  >;
}

beforeAll(() => {
  vi.stubEnv("TAGESTAKT_PUBLIC_URL", "https://plan.tagestakt.test");
  vi.stubEnv(
    "CONNECTOR_DATABASE_URL",
    "postgres://tagestakt_connector:nur-ein-testwert@127.0.0.1:5432/postgres",
  );
  resetConnectorConfigForTests();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetConnectorConfigForTests();
});

beforeEach(() => {
  vi.clearAllMocks();
  store.verifyAccessToken.mockImplementation(async (_config: unknown, token: string) => {
    if (token === ACCESS) return access(["planning:read", "planning:draft", "planning:publish"]);
    if (token === READ_ONLY) return access(["planning:read"]);
    if (token === DRAFT_ONLY) return access(["planning:read", "planning:draft"]);
    return null;
  });
  service.getWeekDraft.mockResolvedValue({ weekStart: "2026-10-12", draft: null, published: null });
  service.saveWeekDraft.mockResolvedValue({ saved: true });
});

describe("Endpunkt /mcp", () => {
  it("ohne Token: 401 mit Verweis auf die Ressourcen-Metadaten und alle Scopes", async () => {
    const response = await serverFetch(MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      'resource_metadata="https://plan.tagestakt.test/.well-known/oauth-protected-resource/mcp"',
    );
    expect(challenge).toContain("planning:read planning:draft planning:publish");
  });

  it("ungültiges, abgelaufenes oder widerrufenes Token: 401", async () => {
    for (const token of [`tt_at_${"Z".repeat(43)}`, "kein-token", ""]) {
      const response = await serverFetch(MCP_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(401);
    }
  });

  it("Token für eine andere Ressource wird abgewiesen", async () => {
    store.verifyAccessToken.mockResolvedValue({
      ...access(["planning:read"]),
      resource: "https://andere.tagestakt.test/mcp",
    });
    const response = await serverFetch(MCP_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${ACCESS}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  it("fremder Host oder fremder Browser-Origin: abgewiesen (DNS-Rebinding/CSRF)", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const wrongHost = await handleMcpHttp(
      new Request(MCP_URL, {
        method: "POST",
        headers: { host: "boese.tagestakt.test", authorization: `Bearer ${ACCESS}` },
        body,
      }),
    );
    expect(wrongHost.status).toBeGreaterThanOrEqual(400);
    const wrongOrigin = await serverFetch(MCP_URL, {
      method: "POST",
      headers: { origin: "https://boese.tagestakt.test", authorization: `Bearer ${ACCESS}` },
      body,
    });
    expect(wrongOrigin.status).toBe(403);
  });

  it("Handshake: aktuelle Protokollversion und Rückfall auf initialize (2025)", async () => {
    for (const mode of ["auto", "legacy"] as const) {
      const client = await connect(ACCESS, mode);
      expect(client.getServerVersion()?.name).toBe("tagestakt");
      expect(client.getInstructions()).toContain("publish: true");
      expect(client.getInstructions()).toContain("get_activity_history");
      expect(client.getInstructions()).not.toContain("Soll dieser Wochenplan");
      await client.close();
    }
  });
});

describe("Tools", () => {
  it("genau sieben eng begrenzte Tools mit strengen Schemas und passenden Hinweisen", async () => {
    const client = await connect(ACCESS);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "discard_week_draft",
      "get_activity_history",
      "get_planning_context",
      "get_week_draft",
      "publish_week_draft",
      "save_week_draft",
      "validate_week_plan",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/owner_?id|ownerId|sql|query|table/i);
      expect(tool.annotations?.openWorldHint).toBe(false);
    }
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(byName.get_planning_context?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get_activity_history?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get_activity_history?.description).toContain(
      "keine Titel, Notizen, Orte oder IDs",
    );
    expect(byName.publish_week_draft?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(Object.keys(byName.publish_week_draft?.inputSchema.properties ?? {}).sort()).toEqual([
      "expectedDraftRef",
      "weekStart",
    ]);
    expect(byName.save_week_draft?.inputSchema.properties).toHaveProperty("publish");
    await client.close();
  });

  it("get_activity_history: nur mit Lese-Scope, Wochen 1–12, sonst nichts", async () => {
    service.getActivityHistory.mockResolvedValue({ weeks: [], summary: [] });
    const client = await connect(READ_ONLY);
    const ok = await client.callTool({
      name: "get_activity_history",
      arguments: { weeks: 4, includeCurrentWeek: false },
    });
    expect(ok.isError).toBeFalsy();
    expect(service.getActivityHistory).toHaveBeenCalledWith(
      expect.anything(),
      { ownerId: OWNER, grantId: GRANT },
      { weeks: 4, includeCurrentWeek: false },
    );
    for (const args of [{ weeks: 0 }, { weeks: 13 }, { weeks: 2.5 }, { ownerId: FOREIGN }]) {
      const result = await client.callTool({ name: "get_activity_history", arguments: args });
      expect(result.isError).toBe(true);
    }
    expect(service.getActivityHistory).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it("unbekannte Felder und eine übergebene owner_id werden abgelehnt", async () => {
    const client = await connect(ACCESS);
    for (const args of [
      { weekStart: "2026-10-12", owner_id: FOREIGN },
      { weekStart: "2026-10-12", ownerId: FOREIGN },
      { weekStart: "2026-10-12", sql: "select 1" },
    ]) {
      const result = await client.callTool({ name: "get_week_draft", arguments: args });
      expect(result.isError).toBe(true);
    }
    expect(service.getWeekDraft).not.toHaveBeenCalled();
    await client.close();
  });

  it("Identität stammt ausschließlich aus dem Token", async () => {
    const client = await connect(ACCESS);
    const result = await client.callTool({
      name: "get_week_draft",
      arguments: { weekStart: "2026-10-12" },
    });
    expect(result.isError).toBeFalsy();
    expect(service.getWeekDraft).toHaveBeenCalledWith(
      expect.anything(),
      { ownerId: OWNER, grantId: GRANT },
      "2026-10-12",
    );
    expect(JSON.stringify(service.getWeekDraft.mock.calls)).not.toContain(FOREIGN);
    await client.close();
  });

  it("Scope-Trennung: nur lesen darf weder speichern noch veröffentlichen", async () => {
    const client = await connect(READ_ONLY);
    const read = await client.callTool({
      name: "get_week_draft",
      arguments: { weekStart: "2026-10-12" },
    });
    expect(read.isError).toBeFalsy();
    for (const call of [
      {
        name: "save_week_draft",
        arguments: { weekStart: "2026-10-12", blocks: [], expectedDraftRef: null },
      },
      {
        name: "publish_week_draft",
        arguments: { weekStart: "2026-10-12", expectedDraftRef: "a".repeat(64) },
      },
    ]) {
      await expect(
        client.callTool(call).then((result) => {
          if (result.isError) throw new Error(text(result).message as string);
          return result;
        }),
      ).rejects.toThrow();
    }
    expect(service.saveWeekDraft).not.toHaveBeenCalled();
    expect(service.publishWeekDraft).not.toHaveBeenCalled();
    await client.close();
  });

  it("Scope-Trennung: Speichern mit publish: true braucht auch planning:publish", async () => {
    const client = await connect(DRAFT_ONLY);
    const input = { weekStart: "2026-10-12", blocks: [], expectedDraftRef: null };
    const denied = await client.callTool({
      name: "save_week_draft",
      arguments: { ...input, publish: true },
    });
    expect(denied.isError).toBe(true);
    expect(service.saveWeekDraft).not.toHaveBeenCalled();
    const saved = await client.callTool({ name: "save_week_draft", arguments: input });
    expect(saved.isError).toBeFalsy();
    await client.close();

    const full = await connect(ACCESS);
    const published = await full.callTool({
      name: "save_week_draft",
      arguments: { ...input, publish: true },
    });
    expect(published.isError).toBeFalsy();
    expect(service.saveWeekDraft).toHaveBeenLastCalledWith(
      expect.anything(),
      { ownerId: OWNER, grantId: GRANT },
      expect.objectContaining({ publish: true }),
    );
    await full.close();
  });

  it("publish_week_draft braucht keine Bestätigung, nur Woche und draftRef", async () => {
    service.publishWeekDraft.mockResolvedValue({ published: true, version: 2, publishedAt: null });
    const client = await connect(ACCESS);
    const result = await client.callTool({
      name: "publish_week_draft",
      arguments: { weekStart: "2026-10-12", expectedDraftRef: "a".repeat(64) },
    });
    expect(result.isError).toBeFalsy();
    expect(service.publishWeekDraft).toHaveBeenCalledWith(
      expect.anything(),
      { ownerId: OWNER, grantId: GRANT },
      { weekStart: "2026-10-12", expectedDraftRef: "a".repeat(64) },
    );
    const extra = await client.callTool({
      name: "publish_week_draft",
      arguments: {
        weekStart: "2026-10-12",
        expectedDraftRef: "a".repeat(64),
        confirmationId: "Wochenplan veröffentlichen",
      },
    });
    expect(extra.isError).toBe(true);
    await client.close();
  });

  it("Fachfehler kommen als Tool-Fehler ohne interne Details zurück", async () => {
    service.getWeekDraft.mockRejectedValue(
      Object.assign(new Error("relation public.schedule_weeks ..."), { code: "42P01" }),
    );
    const client = await connect(ACCESS);
    const result = await client.callTool({
      name: "get_week_draft",
      arguments: { weekStart: "2026-10-12" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("schedule_weeks");
    expect(text(result).error).toBe("failed");
    await client.close();
  });
});
