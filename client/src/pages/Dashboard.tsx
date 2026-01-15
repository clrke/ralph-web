import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@claude-code-web/shared';

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

  useEffect(() => {
    async function fetchSessions() {
      try {
        const response = await fetch('/api/sessions');
        if (!response.ok) {
          throw new Error('Failed to fetch sessions');
        }
        const data = await response.json();
        setSessions(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setIsLoading(false);
      }
    }

    fetchSessions();
  }, []);

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

      <section>
        <h2 className="text-xl font-semibold mb-4">Recent Sessions</h2>

        {isLoading && (
          <div className="bg-gray-800 rounded-lg p-6 text-gray-400">
            Loading sessions...
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-400">
            {error}
          </div>
        )}

        {!isLoading && !error && sessions.length === 0 && (
          <div className="bg-gray-800 rounded-lg p-6 text-gray-400">
            No sessions yet. Create your first session to get started.
          </div>
        )}

        {!isLoading && !error && sessions.length > 0 && (
          <div className="space-y-3">
            {sessions.map((session) => (
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
    </div>
  );
}
