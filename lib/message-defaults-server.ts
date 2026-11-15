import { prisma } from "@/lib/db/client";
import { resolveMessageDefaults, type MessageDefaults } from "./message-defaults";

// The worker reads these on every comment; a short cache keeps that to one
// query per workspace per minute. Edits show up within that minute.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: MessageDefaults }>();

export async function getMessageDefaults(workspaceId: string): Promise<MessageDefaults> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let stored: unknown = null;
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { messageDefaults: true },
    });
    stored = workspace?.messageDefaults;
  } catch {
    // A database hiccup must not stop a send: use the built-in wording.
  }
  const value = resolveMessageDefaults(stored);
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}

export function forgetMessageDefaults(workspaceId: string) {
  cache.delete(workspaceId);
}
