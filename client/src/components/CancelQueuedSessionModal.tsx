import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface CancelQueuedSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  sessionTitle: string;
  isLoading?: boolean;
}

export default function CancelQueuedSessionModal({
  isOpen,
  onClose,
  onConfirm,
  sessionTitle,
  isLoading = false,
}: CancelQueuedSessionModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    },
    [onClose, isLoading]
  );

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
      onClick={isLoading ? undefined : onClose}
      data-testid="cancel-queued-session-modal-backdrop"
    >
      <div
        className="bg-gray-800 rounded-lg w-full max-w-md flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="cancel-queued-session-modal"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-gray-100">Cancel Queued Session</h3>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
            data-testid="close-button"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 space-y-4">
          <p className="text-gray-300 text-sm">
            Are you sure you want to cancel{' '}
            <span className="font-medium text-white">{sessionTitle}</span>?
          </p>

          {/* Warning */}
          <div className="flex items-start gap-3 p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
            <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-red-300">
              This session will be permanently removed from the queue. This action cannot be undone.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            data-testid="cancel-button"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            data-testid="confirm-button"
          >
            {isLoading && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {isLoading ? 'Removing...' : 'Remove from Queue'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
