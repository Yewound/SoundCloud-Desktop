import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { roomsApi } from '../../lib/together/api';
import type { OpenRoom } from '../../lib/together/types';

const REFRESH_MS = 20_000;

let missing = false;
let lastRooms: OpenRoom[] | null = null;

export interface OpenRooms {
  available: boolean;
  rooms: OpenRoom[] | null;
  loading: boolean;
  failed: boolean;
  refresh: () => void;
}

export function useOpenRooms(watching: boolean): OpenRooms {
  const [rooms, setRooms] = useState(lastRooms);
  const [available, setAvailable] = useState(!missing);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (missing || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    roomsApi
      .open()
      .then((next) => {
        lastRooms = next;
        if (!mounted.current) return;
        setRooms(next);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) missing = true;
        if (!mounted.current) return;
        setAvailable(!missing);
        setFailed(true);
      })
      .finally(() => {
        inFlight.current = false;
        if (mounted.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [watching, refresh]);

  return { available, rooms, loading, failed, refresh };
}
