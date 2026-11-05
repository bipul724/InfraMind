import { useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/apiClient';
import type { ProgressPayload, SessionFilesResponse, SessionStatusResponse } from '@/lib/session';

// The backstop for missed progress events (B2.1): while a session is in flight, its
// status is polled. Every 5 s for the first 10 minutes, then every 30 s; after 30
// minutes polling stops and onGiveUp is called (the page asks for a reload).
export const POLL_INTERVAL_MS = 5000;
export const SLOW_POLL_INTERVAL_MS = 30000;
export const SLOW_POLL_AFTER_MS = 10 * 60 * 1000;
export const STOP_POLLING_AFTER_MS = 30 * 60 * 1000;

export interface PollUpdate {
  payload: ProgressPayload;
  // Set once, when the poll saw "completed" and loaded GET /api/files/:sessionId
  files?: SessionFilesResponse;
}

interface Options {
  sessionId?: string | null;
  // Poll only while true; the timer is created and cleared with this flag, so a
  // re-render never adds a second timer
  active: boolean;
  onUpdate: (update: PollUpdate) => void;
  onGiveUp: () => void;
}

export function useSessionPoller({ sessionId, active, onUpdate, onGiveUp }: Options) {
  // The latest callbacks, read at call time, so they are not effect dependencies
  const onUpdateRef = useRef(onUpdate);
  const onGiveUpRef = useRef(onGiveUp);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
    onGiveUpRef.current = onGiveUp;
  });
  // When polling began for each session, so pausing and resuming does not reset the
  // back-off clock
  const startedAtRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!active || !sessionId) return;
    const id = sessionId;
    if (!startedAtRef.current.has(id)) startedAtRef.current.set(id, Date.now());
    const startedAt = startedAtRef.current.get(id) as number;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (stopped) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= STOP_POLLING_AFTER_MS) {
        stopped = true;
        onGiveUpRef.current();
        return;
      }
      timer = setTimeout(tick, elapsed >= SLOW_POLL_AFTER_MS ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
    };

    const tick = async () => {
      if (stopped) return;
      try {
        const response = await apiFetch(`/api/status/${id}`);
        if (stopped) return;
        if (response.ok) {
          const session: SessionStatusResponse = await response.json();
          if (stopped) return;
          if (session.status === 'completed') {
            // The result, once: the same fields the completed event carries, plus the review
            const filesResponse = await apiFetch(`/api/files/${id}`);
            if (stopped) return;
            if (filesResponse.ok) {
              const files: SessionFilesResponse = await filesResponse.json();
              if (stopped) return;
              stopped = true;
              onUpdateRef.current({
                files,
                payload: {
                  sessionId: id,
                  status: 'completed',
                  step: 'Analysis complete!',
                  progress: 100,
                  techStack: files.techStack ?? null,
                  generatedFiles: Object.keys(files.files ?? {}),
                  messages: Array.isArray(files.messages) ? files.messages : [],
                  errors: Array.isArray(files.errors) ? files.errors : []
                }
              });
              return;
            }
          } else if (session.status === 'failed') {
            stopped = true;
            onUpdateRef.current({
              payload: { sessionId: id, status: 'failed', step: 'Analysis failed', progress: 0, error: session.error || 'Analysis failed' }
            });
            return;
          } else {
            onUpdateRef.current({ payload: { sessionId: id, status: session.status } });
          }
        }
      } catch {
        // Offline or the server is restarting: try again at the next interval
      }
      schedule();
    };

    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, active]);
}
