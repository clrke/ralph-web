import { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { PlanStep } from '@claude-code-web/shared';
import { useSessionStore, ConversationEntry, ExecutionStatus } from '../../stores/sessionStore';
import { generateConversationLabel, getStageColor, truncateText } from './labelUtils';
import { ValidationActionBadge } from './StatusBadges';

interface ConversationPanelProps {
  projectId: string;
  featureId: string;
}

const PAGE_SIZE = 10;

export function ConversationPanel({ projectId, featureId }: ConversationPanelProps) {
  const {
    conversations,
    executionStatus,
    liveOutput,
    isOutputComplete,
    fetchConversations,
    plan,
  } = useSessionStore();

  const [currentPage, setCurrentPage] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations(projectId, featureId);
  }, [projectId, featureId, fetchConversations]);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (outputRef.current && !isOutputComplete) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [liveOutput, isOutputComplete]);

  // Reset to first page when new conversations arrive
  useEffect(() => {
    setCurrentPage(0);
  }, [conversations.length]);

  const isRunning = executionStatus?.status === 'running';
  const totalCost = conversations.reduce((sum, c) => sum + c.costUsd, 0);

  // Pagination
  const reversedConversations = [...conversations].reverse();
  const totalPages = Math.ceil(reversedConversations.length / PAGE_SIZE);
  const paginatedConversations = reversedConversations.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Header - no longer a button */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <StatusIndicator status={executionStatus} />
          <h2 className="font-semibold">Claude Conversation</h2>
          {conversations.length > 0 && (
            <span className="text-sm text-gray-400">
              ({conversations.length} exchange{conversations.length !== 1 ? 's' : ''})
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {totalCost > 0 && (
            <span className="text-sm text-gray-400">
              ${totalCost.toFixed(4)} total
            </span>
          )}
        </div>
      </div>

      {/* Always visible content */}
      <div>
        {/* Live output when running */}
        {isRunning && (
          <div className="p-4 border-b border-gray-700 bg-gray-900/50">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm text-blue-400">
                {executionStatus?.action || 'Processing...'}
              </span>
            </div>
            <div
              ref={outputRef}
              className="font-mono text-sm text-gray-300 max-h-64 overflow-y-auto whitespace-pre-wrap"
            >
              {liveOutput || 'Waiting for output...'}
            </div>
          </div>
        )}

        {/* Conversation history */}
        <div className="overflow-y-auto">
          {conversations.length === 0 && !isRunning ? (
            <div className="p-8 text-center text-gray-500">
              No conversation history yet
            </div>
          ) : (
            paginatedConversations.map((entry, index) => (
              <ConversationEntryCard
                key={currentPage * PAGE_SIZE + index}
                entry={entry}
                index={conversations.length - 1 - (currentPage * PAGE_SIZE + index)}
                planSteps={plan?.steps}
              />
            ))
          )}
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-gray-700">
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: ExecutionStatus | null }) {
  if (!status) {
    return (
      <div className="w-3 h-3 rounded-full bg-gray-500" title="Idle" />
    );
  }

  switch (status.status) {
    case 'running':
      return (
        <div className="relative">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <div className="absolute inset-0 w-3 h-3 rounded-full bg-blue-500 animate-ping" />
        </div>
      );
    case 'error':
      return (
        <div className="w-3 h-3 rounded-full bg-red-500" title="Error" />
      );
    case 'idle':
    default:
      return (
        <div className="w-3 h-3 rounded-full bg-green-500" title="Ready" />
      );
  }
}

/**
 * Badge showing conversation entry status (started/completed/interrupted)
 */
function ConversationStatusBadge({ status }: { status?: 'started' | 'completed' | 'interrupted' }) {
  if (!status) return null;

  switch (status) {
    case 'started':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-900/50 text-blue-300 border border-blue-700">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          In Progress
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-green-900/50 text-green-300 border border-green-700">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Completed
        </span>
      );
    case 'interrupted':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-yellow-900/50 text-yellow-300 border border-yellow-700">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Interrupted
        </span>
      );
    default:
      return null;
  }
}

interface ConversationEntryCardProps {
  entry: ConversationEntry;
  index: number;
  planSteps?: PlanStep[];
}

function ConversationEntryCard({ entry, index, planSteps }: ConversationEntryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [modalContent, setModalContent] = useState<{ title: string; content: string } | null>(null);

  const stageLabel = generateConversationLabel(entry, planSteps);

  return (
    <div className={`border-b border-gray-700 last:border-b-0 ${entry.isError ? 'bg-red-900/10' : ''}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-400">#{index + 1}</span>
          <span className={`px-2 py-0.5 text-xs rounded ${getStageColor(entry.stage, entry.postProcessingType)}`}>
            {stageLabel}
          </span>
          <ConversationStatusBadge status={entry.status} />
          {entry.validationAction && (
            <ValidationActionBadge action={entry.validationAction} />
          )}
          {entry.isError && (
            <span className="text-xs text-red-400">Error</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{formatTimestamp(entry.timestamp)}</span>
          {entry.costUsd > 0 && (
            <span>${entry.costUsd.toFixed(4)}</span>
          )}
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-400">Prompt</h4>
              {entry.prompt.length > 2000 && (
                <button
                  onClick={() => setModalContent({ title: `Prompt #${index + 1}`, content: entry.prompt })}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  View full ({entry.prompt.length.toLocaleString()} chars)
                </button>
              )}
            </div>
            <div className="bg-gray-900/50 rounded p-3 font-mono text-sm text-gray-300 overflow-y-auto whitespace-pre-wrap">
              {truncateText(entry.prompt, 2000)}
            </div>
          </div>

          {/* Output */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-400">Output</h4>
              {entry.output.length > 2000 && (
                <button
                  onClick={() => setModalContent({ title: `Output #${index + 1}`, content: entry.output })}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  View full ({entry.output.length.toLocaleString()} chars)
                </button>
              )}
            </div>
            <div className={`bg-gray-900/50 rounded p-3 font-mono text-sm overflow-y-auto whitespace-pre-wrap ${
              entry.isError ? 'text-red-300' : 'text-gray-300'
            }`}>
              {entry.output ? truncateText(entry.output, 2000) : (
                entry.status === 'started' ? (
                  <span className="text-blue-400 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                    Waiting for response...
                  </span>
                ) : '(empty)'
              )}
            </div>
          </div>

          {/* Error message */}
          {entry.error && (
            <div>
              <h4 className="text-sm font-medium text-red-400 mb-2">Error</h4>
              <div className="bg-red-900/20 rounded p-3 font-mono text-sm text-red-300">
                {entry.error}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full Content Modal */}
      <FullContentModal
        isOpen={modalContent !== null}
        onClose={() => setModalContent(null)}
        title={modalContent?.title || ''}
        content={modalContent?.content || ''}
      />
    </div>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface FullContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

function FullContentModal({ isOpen, onClose, title, content }: FullContentModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">
              {content.length.toLocaleString()} chars
            </span>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="font-mono text-sm text-gray-300 whitespace-pre-wrap break-words">
            {content}
          </pre>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-gray-700">
          <button
            onClick={() => navigator.clipboard.writeText(content)}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Copy to clipboard
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
