import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Native provider auth shape containing only the ephemeral local relay token.
 * A guest cannot refresh or persist credentials through this read-only store. */
export function relayCredentials(providerId: string, token: string): NonNullable<Parameters<typeof ModelRuntime.create>[0]>["credentials"] {
  const credential = providerId === "openai-codex"
    ? {type: "oauth" as const, access: token, refresh: "local-relay-no-refresh", expires: Date.now() + 24 * 60 * 60 * 1000}
    : {type: "api_key" as const, key: token};
  return {
    async read(provider) { return provider === providerId ? credential : undefined; },
    async list() { return [{providerId, type: credential.type}]; },
    async modify() { throw new Error("Local model relay credentials cannot refresh or mutate"); },
    async delete() { throw new Error("Local model relay credentials cannot mutate"); },
  };
}
