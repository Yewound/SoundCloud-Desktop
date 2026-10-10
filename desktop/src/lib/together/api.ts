import { api } from '../api';
import type { OpenRoom, PlaybackUpdate, Profile, RoomView } from './types';

const POLL_TIMEOUT_MS = 35_000;
const QUICK_TIMEOUT_MS = 12_000;
const QUIET = { quiet: true, silentStatuses: [403, 404, 409, 429, 503] };
const QUIET_LIST = { quiet: true, silentStatuses: [404, 429, 503] };

export interface Timed {
  view: RoomView;
  sentAt: number;
  receivedAt: number;
}

async function timed(path: string, init: RequestInit, timeoutMs: number): Promise<Timed> {
  const sentAt = Date.now();
  const view = await api<RoomView>(path, { ...init, ...QUIET }, timeoutMs);
  return { view, sentAt, receivedAt: Date.now() };
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export const roomsApi = {
  create: (profile: Profile, open: boolean) =>
    timed('/rooms', json('POST', { ...profile, public: open }), QUICK_TIMEOUT_MS),
  join: (code: string, profile: Profile) =>
    timed(`/rooms/${code}/members`, json('POST', profile), QUICK_TIMEOUT_MS),
  peek: (code: string) => timed(`/rooms/${code}?follow=true`, {}, QUICK_TIMEOUT_MS),
  poll: (code: string, since: number) =>
    timed(`/rooms/${code}?since=${since}&follow=true`, {}, POLL_TIMEOUT_MS),
  playback: (code: string, update: PlaybackUpdate) =>
    timed(`/rooms/${code}/playback`, json('PUT', update), QUICK_TIMEOUT_MS),
  ready: (code: string, trackUrn: string) =>
    timed(`/rooms/${code}/ready`, json('PUT', { trackUrn }), QUICK_TIMEOUT_MS),
  visibility: (code: string, open: boolean) =>
    timed(`/rooms/${code}/visibility`, json('PUT', { public: open }), QUICK_TIMEOUT_MS),
  open: () =>
    api<{ collection: OpenRoom[] }>('/rooms/public', QUIET_LIST, QUICK_TIMEOUT_MS).then(
      (page) => page.collection,
    ),
  joinOpen: (hostId: string, profile: Profile) =>
    timed(`/rooms/public/${hostId}/members`, json('POST', profile), QUICK_TIMEOUT_MS),
  leave: (code: string) =>
    api(`/rooms/${code}/members/me`, { method: 'DELETE', ...QUIET }, QUICK_TIMEOUT_MS),
};
