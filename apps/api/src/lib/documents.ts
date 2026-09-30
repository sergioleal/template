import {
  formatHandle,
  LATEST,
  type AgentDocument,
  type AgentOrigin,
  type OwnedAgent,
  type PersonalAgentDocument,
  type VersionListDocument,
} from "@agentikal/shared";
import type { AgentRow, AgentVersionRow } from "../db/schema.ts";
import { pickVersion } from "../db/queries.ts";
import { env } from "../env.ts";

const base = () => env.PUBLIC_BASE_URL;

export const agentUrls = (id: string, version?: string) => {
  const html = version ? `${base()}/a/${id}/v/${version}` : `${base()}/a/${id}`;
  return { html, json: `${html}/json` };
};

export function toAgentDocument(
  agent: AgentRow,
  ownerDisplayName: string,
  v: AgentVersionRow,
  requested: string | null,
  origin: AgentOrigin | null,
): AgentDocument {
  const exact = agentUrls(agent.id, v.version);
  return {
    schemaVersion: "1",
    kind: "mcp",
    id: agent.id,
    handle: agent.handle ? formatHandle(agent.handle) : null,
    name: agent.name,
    summary: agent.summary,
    owner: { displayName: ownerDisplayName },
    origin,
    visibility: agent.visibility,
    tags: agent.tags,
    version: v.version,
    ...(requested && requested !== v.version ? { requested } : {}),
    status: v.status,
    ...(v.status === "yanked" && v.yankedReason ? { yankedReason: v.yankedReason } : {}),
    description: v.description,
    remotes: v.remotes,
    auth: v.auth,
    tools: v.tools,
    examples: v.examples,
    publishedAt: v.publishedAt.toISOString(),
    links: {
      self: exact.json,
      html: exact.html,
      latest: agentUrls(agent.id, LATEST).json,
      versions: `${base()}/a/${agent.id}/versions/json`,
    },
  };
}

export function toPersonalDocument(agent: AgentRow, ownerDisplayName: string): PersonalAgentDocument {
  const urls = agentUrls(agent.id);
  return {
    schemaVersion: "1",
    kind: "personal",
    id: agent.id,
    handle: formatHandle(agent.handle ?? ""),
    name: agent.name,
    summary: agent.summary,
    owner: { displayName: ownerDisplayName },
    createdAt: agent.createdAt.toISOString(),
    links: { self: urls.json, html: urls.html },
  };
}

export function toVersionList(agent: AgentRow, versions: AgentVersionRow[]): VersionListDocument {
  return {
    schemaVersion: "1",
    id: agent.id,
    name: agent.name,
    latest: pickVersion(versions, { kind: "latest" })?.version ?? null,
    versions: versions.map((v) => {
      const urls = agentUrls(agent.id, v.version);
      return { version: v.version, status: v.status, publishedAt: v.publishedAt.toISOString(), links: urls };
    }),
  };
}

export function toOwnedAgent(agent: AgentRow, versions: AgentVersionRow[]): OwnedAgent {
  return {
    id: agent.id,
    kind: agent.kind,
    // Agentes locais sempre têm handle (a migração 0006 preencheu os antigos).
    handle: agent.handle ?? "",
    name: agent.name,
    summary: agent.summary,
    visibility: agent.visibility,
    tags: agent.tags,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    latest: pickVersion(versions, { kind: "latest" })?.version ?? null,
    versions: versions.map((v) => ({
      version: v.version,
      status: v.status,
      yankedReason: v.yankedReason,
      description: v.description,
      remotes: v.remotes,
      auth: v.auth,
      tools: v.tools,
      examples: v.examples,
      publishedAt: v.publishedAt.toISOString(),
    })),
  };
}
