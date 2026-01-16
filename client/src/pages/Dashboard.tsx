import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Session, QueueReorderedEvent } from '@claude-code-web/shared';
import { useSessionStore } from '../stores/sessionStore';
import QueuedSessionsList from '../components/QueuedSessionsList';
import { connectToProject, disconnectFromProject, getSocket } from '../services/socket';

type SessionFilter = 'all' | 'active' | 'paused' | 'completed' | 'failed';

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
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);

  const navigate = useNavigate();

  // Store state for queue management
  const {
    queuedSessions,
    setQueuedSessions,
    isReorderingQueue,
    reorderQueue,
    resumeSession,
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

  // Separate sessions into queued and non-queued, with filtering
  const { nonQueuedSessions, activeSession, pausedSessions, failedSessions, filteredSessions } = useMemo(() => {
    const nonQueued = sessions.filter((s) => s.status !== 'queued');
    const active = sessions.find(
      (s) => s.status !== 'queued' && s.status !== 'completed' && s.status !== 'paused' && s.status !== 'failed'
    );
    const paused = nonQueued.filter((s) => s.status === 'paused');
    const failed = nonQueued.filter((s) => s.status === 'failed');

    // Apply filter
    let filtered = nonQueued;
    switch (filter) {
      case 'active':
        filtered = nonQueued.filter((s) => s.status !== 'completed' && s.status !== 'paused' && s.status !== 'failed');
        break;
      case 'paused':
        filtered = paused;
        break;
      case 'completed':
        filtered = nonQueued.filter((s) => s.status === 'completed');
        break;
      case 'failed':
        filtered = failed;
        break;
      case 'all':
      default:
        filtered = nonQueued;
    }

    return {
      nonQueuedSessions: nonQueued,
      activeSession: active,
      pausedSessions: paused,
      failedSessions: failed,
      filteredSessions: filtered,
    };
  }, [sessions, filter]);

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

  // Handle resume for paused sessions
  const handleResume = useCallback(
    async (session: Session, e: React.MouseEvent) => {
      e.preventDefault(); // Prevent navigation when clicking resume
      e.stopPropagation();

      setResumingSessionId(session.id);
      try {
        await resumeSession(session.projectId, session.featureId);
        // Navigate to the session view after successful resume
        navigate(`/session/${session.projectId}/${session.featureId}`);
      } catch {
        // Error is already set in store
      } finally {
        setResumingSessionId(null);
      }
    },
    [resumeSession, navigate]
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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <h2 className="text-xl font-semibold">
                {queuedSessions.length > 0 ? 'Sessions' : 'Recent Sessions'}
              </h2>

              {/* Filter Tabs */}
              <div className="flex flex-wrap gap-2" data-testid="session-filters">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    filter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  data-testid="filter-all"
                >
                  All ({nonQueuedSessions.length})
                </button>
                <button
                  onClick={() => setFilter('active')}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    filter === 'active'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  data-testid="filter-active"
                >
                  Active ({nonQueuedSessions.filter((s) => s.status !== 'completed' && s.status !== 'paused' && s.status !== 'failed').length})
                </button>
                {pausedSessions.length > 0 && (
                  <button
                    onClick={() => setFilter('paused')}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      filter === 'paused'
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    data-testid="filter-paused"
                  >
                    On Hold ({pausedSessions.length})
                  </button>
                )}
                <button
                  onClick={() => setFilter('completed')}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    filter === 'completed'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  data-testid="filter-completed"
                >
                  Completed ({nonQueuedSessions.filter((s) => s.status === 'completed').length})
                </button>
                {failedSessions.length > 0 && (
                  <button
                    onClick={() => setFilter('failed')}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      filter === 'failed'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    data-testid="filter-failed"
                  >
                    Abandoned ({failedSessions.length})
                  </button>
                )}
              </div>
            </div>

            {filteredSessions.length === 0 ? (
              <div className="bg-gray-800 rounded-lg p-6 text-gray-400">
                {filter === 'all'
                  ? 'No active or completed sessions.'
                  : filter === 'paused'
                  ? 'No sessions on hold.'
                  : filter === 'failed'
                  ? 'No abandoned sessions.'
                  : filter === 'completed'
                  ? 'No completed sessions.'
                  : 'No active sessions.'}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSessions.map((session) => (
                  <Link
                    key={`${session.projectId}/${session.featureId}`}
                    to={`/session/${session.projectId}/${session.featureId}`}
                    className={`block rounded-lg p-4 transition-colors ${
                      session.status === 'paused'
                        ? 'bg-orange-900/20 border border-orange-700/50 hover:bg-orange-900/30'
                        : session.status === 'failed'
                        ? 'bg-red-900/20 border border-red-700/50 hover:bg-red-900/30'
                        : 'bg-gray-800 hover:bg-gray-700'
                    }`}
                    data-testid={`session-card-${session.featureId}`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-lg">{session.title}</h3>
                          {session.status === 'paused' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-orange-600/30 text-orange-300 border border-orange-500/30">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              On Hold
                            </span>
                          )}
                          {session.status === 'failed' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-600/30 text-red-300 border border-red-500/30">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Abandoned
                            </span>
                          )}
                        </div>
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
                        {session.status === 'paused' ? (
                          <button
                            onClick={(e) => handleResume(session, e)}
                            disabled={resumingSessionId === session.id}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                              resumingSessionId === session.id
                                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                : 'bg-green-600 hover:bg-green-500 text-white'
                            }`}
                            data-testid={`resume-button-${session.featureId}`}
                          >
                            {resumingSessionId === session.id ? (
                              <>
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Resuming...
                              </>
                            ) : (
                              <>
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                </svg>
                                Resume
                              </>
                            )}
                          </button>
                        ) : (
                          <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[session.status] || 'bg-gray-600'}`}>
                            {session.status === 'failed' ? 'Abandoned' : `Stage ${session.currentStage}: ${STAGE_LABELS[session.currentStage]}`}
                          </span>
                        )}
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
