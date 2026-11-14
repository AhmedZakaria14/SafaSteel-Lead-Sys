import type { Response } from 'express';

// SSE Subscriber Registry per workspace
const sseClients = new Map<string, Set<Response>>();

export function addSseClient(businessId: string, res: Response) {
  let set = sseClients.get(businessId);
  if (!set) {
    set = new Set();
    sseClients.set(businessId, set);
  }
  set.add(res);
}

export function removeSseClient(businessId: string, res: Response) {
  const set = sseClients.get(businessId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    sseClients.delete(businessId);
  }
}

export function broadcastWorkspaceEvent(businessId: string, event: string, data: Record<string, unknown>) {
  const set = sseClients.get(businessId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}
