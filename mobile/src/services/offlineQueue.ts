import AsyncStorage from '@react-native-async-storage/async-storage';
import { NetInfoState } from '@react-native-community/netinfo';
import { apiClient } from './api';
import { ApiError } from './types';

/**
 * Reliable offline write queue.
 *
 * Requirement: a worker in a basement with no signal must not lose a delivery,
 * and a queued delivery must never be written to the server twice when the
 * connection returns.
 *
 * How duplicates are prevented:
 *  - every queued item carries a client-generated `idempotencyKey`,
 *  - the backend has a UNIQUE constraint on that key,
 *  - on replay, the server returns the ORIGINAL record (HTTP 200 + duplicate)
 *    instead of creating a second one.
 *
 * The queue therefore only needs to be at-least-once; the server makes it
 * effectively-once.
 */

const QUEUE_KEY = '@farah/offline-queue/v1';
const MAX_ATTEMPTS = 8;

export type QueuedOperationKind = 'delivery' | 'payment';

export interface QueuedOperation {
  id: string;
  kind: QueuedOperationKind;
  idempotencyKey: string;
  endpoint: string;
  payload: Record<string, unknown>;
  label: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  /** Set when the server rejected the payload itself (needs user action). */
  permanentlyFailed?: boolean;
}

type Listener = (queue: QueuedOperation[]) => void;

let queue: QueuedOperation[] = [];
let listeners: Listener[] = [];
let flushing = false;
let loaded = false;

function notify(): void {
  const snapshot = [...queue];
  for (const listener of listeners) listener(snapshot);
}

async function persist(): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notify();
}

export async function loadQueue(): Promise<QueuedOperation[]> {
  if (loaded) return queue;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    queue = raw ? (JSON.parse(raw) as QueuedOperation[]) : [];
  } catch {
    queue = [];
  }
  loaded = true;
  notify();
  return queue;
}

export function subscribe(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getQueueSnapshot(): QueuedOperation[] {
  return [...queue];
}

export function pendingCount(): number {
  return queue.filter((item) => !item.permanentlyFailed).length;
}

export function failedItems(): QueuedOperation[] {
  return queue.filter((item) => item.permanentlyFailed);
}

/** Enqueues a write. Returns the queued operation. */
export async function enqueue(
  kind: QueuedOperationKind,
  endpoint: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  label: string,
): Promise<QueuedOperation> {
  await loadQueue();
  const item: QueuedOperation = {
    id: `${kind}-${idempotencyKey}`,
    kind,
    idempotencyKey,
    endpoint,
    payload,
    label,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  // Guard against double-enqueueing the same operation locally.
  queue = queue.filter((q) => q.idempotencyKey !== idempotencyKey);
  queue.push(item);
  await persist();
  return item;
}

/**
 * Attempts to push every pending item to the server, oldest first.
 * Returns how many were accepted.
 */
export async function flush(): Promise<{ synced: number; failed: number; remaining: number }> {
  await loadQueue();
  if (flushing) return { synced: 0, failed: 0, remaining: pendingCount() };
  flushing = true;

  let synced = 0;
  let failed = 0;

  try {
    const pending = queue.filter((item) => !item.permanentlyFailed);
    for (const item of pending) {
      try {
        await apiClient.post(item.endpoint, item.payload);
        queue = queue.filter((q) => q.id !== item.id);
        synced++;
      } catch (err) {
        item.attempts += 1;
        item.lastError = err instanceof Error ? err.message : 'Naməlum xəta';

        // A 4xx (other than 429) means the payload itself is wrong; retrying
        // forever would never succeed and would silently block the queue.
        const isValidation = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
        if (isValidation || item.attempts >= MAX_ATTEMPTS) {
          item.permanentlyFailed = true;
        }
        failed++;
      }
    }
    await persist();
  } finally {
    flushing = false;
  }

  return { synced, failed, remaining: pendingCount() };
}

/** Re-queues items the user wants to retry after fixing them. */
export async function retryFailed(): Promise<void> {
  await loadQueue();
  queue = queue.map((item) =>
    item.permanentlyFailed ? { ...item, permanentlyFailed: false, attempts: 0 } : item,
  );
  await persist();
}

export async function discardFailed(): Promise<void> {
  await loadQueue();
  queue = queue.filter((item) => !item.permanentlyFailed);
  await persist();
}

/** Called when connectivity returns: immediately push anything pending. */
export function onNetworkChange(state: NetInfoState): void {
  if (state.isConnected) void flush();
}
