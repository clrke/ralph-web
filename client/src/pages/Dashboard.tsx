import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Session, QueueReorderedEvent } from '@claude-code-web/shared';
import { useSessionStore } from '../stores/sessionStore';
import QueuedSessionsList from '../components/QueuedSessionsList';
import { connectToProject, disconnectFromProject, getSocket } from '../services/socket';

const STAGE_LABELS: Record<number, string> = {
  0: 'Queued',
  1: 'Discovery',
  2: 'Planning',
  3: 'Implementing',
  4: 'PR Creation',
  5: 'PR Review',
  6: 'Final Approval',
  7: 'Completed',
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-yellow-700',
  discovery: 'bg-blue-600',
  planning: 'bg-yellow-600',
  implementing: 'bg-purple-600',
  pr_creation: 'bg-green-600',
  pr_review: 'bg-teal-600',
  final_approval: 'bg-emerald-600',
  completed: 'bg-gray-600',
  paused: 'bg-orange-600',
  failed: 'bg-red-600',
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'active just now';
  } else if (diffMinutes < 60) {
    return `active ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `active ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `active ${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    return `active ${date.toLocaleDateString()}`;
  }
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Store state for queue management
  const {
    queuedSessions,
    setQueuedSessions,
    isReorderingQueue,
    reorderQueue,
    error: storeError,
    setError: setStoreError,
  } = useSessionStore();

  useEffect(() => {
    async function fetchSessions() {
      try {
        const response = await fetch('/api/sessions');
        if (!response.ok) {
          throw new Error('Failed to fetch sessions');
        }
        const data = await response.json();
        setSessions(data);

        // Separate queued sessions and store in global state
        const queued = data.filter((s: Session) => s.status === 'queued');
        setQueuedSessions(queued);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setIsLoading(false);
      }
    }

    fetchSessions();
  }, [setQueuedSessions]);

  // Separate sessions into queued and non-queued
  const { nonQueuedSessions, activeSession } = useMemo(() => {
    const nonQueued = sessions.filter((s) => s.status !== 'queued');
    const active = sessions.find(
      (s) => s.status !== 'queued' && s.status !== 'completed' && s.status !== 'paused'
    );
    return { nonQueuedSessions: nonQueued, activeSession: active };
  }, [sessions]);

  // Get the projectId for reordering (from active session or first queued session)
  const projectId = useMemo(() => {
    if (activeSession) return activeSession.projectId;
    if (queuedSessions.length > 0) return queuedSessions[0].projectId;
    return null;
  }, [activeSession, queuedSessions]);

  // Track connected project for cleanup
  const connectedProjectRef = useRef<string | null>(null);

  // Connect to Socket.IO for real-time queue updates
  useEffect(() => {
    if (!projectId) return;

    // Connect to project room
    connectToProject(projectId);
    connectedProjectRef.current = projectId;

    const socket = getSocket();

    // Listen for queue reorder events from other clients
    const handleQueueReordered = (event: QueueReorderedEvent) => {
      if (event.projectId === projectId) {
        // Update queued sessions with new positions using store's method
        const { queuedSessions: currentSessions } = useSessionStore.getState();
        const updatedSessions = currentSessions.map((session) => {
          const update = event.queuedSessions.find(
            (q) => q.featureId === session.featureId
          );
          if (update) {
            return { ...session, queuePosition: update.queuePosition };
          }
          return session;
        });
        // Sort by queue position and update store
        const sortedSessions = updatedSessions.sort(
          (a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0)
        );
        setQueuedSessions(sortedSessions);
      }
    };

    socket.on('queue.reordered', handleQueueReordered);

    return () => {
      socket.off('queue.reordered', handleQueueReordered);
      if (connectedProjectRef.current) {
        disconnectFromProject(connectedProjectRef.current);
        connectedProjectRef.current = null;
      }
    };
  }, [projectId, setQueuedSessions]);

  const handleReorder = useCallback(
    async (orderedFeatureIds: string[]) => {
      if (!projectId) return;
      try {
        await reorderQueue(projectId, orderedFeatureIds);
      } catch {
        // Error is already set in store
      }
    },
    [projectId, reorderQueue]
  );

  // Clear store error when component unmounts
  useEffect(() => {
    return () => setStoreError(null);
  }, [setStoreError]);

  // Display combined errors
  const displayError = error || storeError;

  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Claude Code Web</h1>
        <p className="text-gray-400 mt-2">Manage your Claude Code sessions</p>
      </header>

      <div className="mb-8">
        <Link
          to="/new"
          className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </Link>
      </div>

      {displayError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-400 mb-6">
          {displayError}
        </div>
      )}

      {isLoading && (
        <div className="bg-gray-800 rounded-lg p-6 text-gray-400">
          Loading sessions...
        </div>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-6 text-gray-400">
          No sessions yet. Create your first session to get started.
        </div>
      )}

      {!isLoading && !error && sessions.length > 0 && (
        <>
          {/* Queued Sessions Section */}
          {queuedSessions.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <span className="text-yellow-500">Queue</span>
                <span className="text-gray-500 text-sm font-normal">
                  ({queuedSessions.length} session{queuedSessions.length !== 1 ? 's' : ''})
                </span>
                {queuedSessions.length > 1 && (
                  <span className="text-gray-600 text-xs font-normal ml-2">
                    Drag to reorder
                  </span>
                )}
              </h2>
              <QueuedSessionsList
                sessions={queuedSessions}
                onReorder={handleReorder}
                isReordering={isReorderingQueue}
                formatRelativeTime={formatRelativeTime}
              />
            </section>
          )}

          {/* Active and Other Sessions */}
          <section>
            <h2 className="text-xl font-semibold mb-4">
              {queuedSessions.length > 0 ? 'Active & Completed Sessions' : 'Recent Sessions'}
            </h2>

            {nonQueuedSessions.length === 0 ? (
              <div className="bg-gray-800 rounded-lg p-6 text-gray-400">
                No active or completed sessions.
              </div>
            ) : (
              <div className="space-y-3">
                {nonQueuedSessions.map((session) => (
                  <Link
                    key={`${session.projectId}/${session.featureId}`}
                    to={`/session/${session.projectId}/${session.featureId}`}
                    className="block bg-gray-800 hover:bg-gray-700 rounded-lg p-4 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-lg">{session.title}</h3>
                        <p className="text-gray-400 text-sm mt-1 truncate">
                          {session.projectPath}
                        </p>
                        {session.featureDescription && (
                          <p className="text-gray-500 text-sm mt-1 line-clamp-2">
                            {session.featureDescription}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 sm:ml-4 flex-wrap">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[session.status] || 'bg-gray-600'}`}>
                          Stage {session.currentStage}: {STAGE_LABELS[session.currentStage]}
                        </span>
                        <span className="text-gray-500 text-sm">
                          {formatRelativeTime(new Date(session.updatedAt))}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
