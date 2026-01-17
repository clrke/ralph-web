import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CancelQueuedSessionModal from './CancelQueuedSessionModal';

describe('CancelQueuedSessionModal', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();
  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onConfirm: mockOnConfirm,
    sessionTitle: 'Test Feature',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up body styles
    document.body.style.overflow = '';
  });

  describe('rendering', () => {
    it('renders modal when isOpen is true', () => {
      render(<CancelQueuedSessionModal {...defaultProps} />);

      expect(screen.getByTestId('cancel-queued-session-modal')).toBeInTheDocument();
      expect(screen.getByText('Cancel Queued Session')).toBeInTheDocument();
    });

    it('does not render modal when isOpen is false', () => {
      render(<CancelQueuedSessionModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByTestId('cancel-queued-session-modal')).not.toBeInTheDocument();
    });

    it('displays session title in the content', () => {
      render(<CancelQueuedSessionModal {...defaultProps} sessionTitle="My Feature" />);

      expect(screen.getByText('My Feature')).toBeInTheDocument();
    });

    it('displays warning text about permanent removal', () => {
      render(<CancelQueuedSessionModal {...defaultProps} />);

      expect(screen.getByText(/permanently removed from the queue/)).toBeInTheDocument();
      expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    });

    it('renders cancel and confirm buttons', () => {
      render(<CancelQueuedSessionModal {...defaultProps} />);

      expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-button')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Remove from Queue')).toBeInTheDocument();
    });
  });

  describe('close behavior', () => {
    it('calls onClose when cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<CancelQueuedSessionModal {...defaultProps} />);

      await user.click(screen.getByTestId('cancel-button'));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<CancelQueuedSessionModal {...defaultProps} />);

      await user.click(screen.getByTestId('close-button'));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when backdrop is clicked', async () => {
      const user = userEvent.setup();
      render(<CancelQueuedSessionModal {...defaultProps} />);

      await user.click(screen.getByTestId('cancel-queued-session-modal-backdrop'));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('does not close when modal content is clicked', async () => {
      const user = userEvent.setup();
      render(<CancelQueuedSessionModal {...defaultProps} />);

      await user.click(screen.getByTestId('cancel-queued-session-modal'));

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('calls onClose when Escape key is pressed', async () => {
      render(<CancelQueuedSessionModal {...defaultProps} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('confirm action', () => {
    it('calls onConfirm when confirm button is clicked', async () => {
      const user = userEvent.setup();
      render(<CancelQueuedSessionModal {...defaultProps} />);

      await user.click(screen.getByTestId('confirm-button'));

      expect(mockOnConfirm).toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('disables confirm button when loading', () => {
      render(<CancelQueuedSessionModal {...defaultProps} isLoading />);

      expect(screen.getByTestId('confirm-button')).toBeDisabled();
    });

    it('shows loading spinner and text when loading', () => {
      render(<CancelQueuedSessionModal {...defaultProps} isLoading />);

      expect(screen.getByText('Removing...')).toBeInTheDocument();
      expect(screen.queryByText('Remove from Queue')).not.toBeInTheDocument();
    });

    it('disables cancel button when loading', () => {
      render(<CancelQueuedSessionModal {...defaultProps} isLoading />);

      expect(screen.getByTestId('cancel-button')).toBeDisabled();
    });

    it('disables close button when loading', () => {
      render(<CancelQueuedSessionModal {...defaultProps} isLoading />);

      expect(screen.getByTestId('close-button')).toBeDisabled();
    });

    it('does not close on backdrop click when loading', async () => {
      const user = userEvent.setup();
      render(<CancelQueuedSessionModal {...defaultProps} isLoading />);

      await user.click(screen.getByTestId('cancel-queued-session-modal-backdrop'));

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('does not close on Escape when loading', () => {
      render(<CancelQueuedSessionModal {...defaultProps} isLoading />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('prevents body scrolling when open', () => {
      render(<CancelQueuedSessionModal {...defaultProps} />);

      expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body scrolling when closed', () => {
      const { unmount } = render(<CancelQueuedSessionModal {...defaultProps} />);

      unmount();

      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('button styles', () => {
    it('confirm button has red styling', () => {
      render(<CancelQueuedSessionModal {...defaultProps} />);

      expect(screen.getByTestId('confirm-button')).toHaveClass('bg-red-600');
    });

    it('cancel button has gray styling', () => {
      render(<CancelQueuedSessionModal {...defaultProps} />);

      expect(screen.getByTestId('cancel-button')).toHaveClass('bg-gray-700');
    });
  });
});
