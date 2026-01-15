import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageStatusBadge } from './StageStatusBadge';

describe('StageStatusBadge', () => {
  describe('stage display', () => {
    it('renders stage number and name for Stage 1', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
          action="stage1_started"
        />
      );

      expect(screen.getByText(/Stage 1:/)).toBeInTheDocument();
      expect(screen.getByText(/Discovery/)).toBeInTheDocument();
    });

    it('renders stage number and name for Stage 2', () => {
      render(
        <StageStatusBadge
          stage={2}
          status="running"
          action="stage2_started"
        />
      );

      expect(screen.getByText(/Stage 2:/)).toBeInTheDocument();
      expect(screen.getByText(/Planning/)).toBeInTheDocument();
    });

    it('renders stage number and name for Stage 3', () => {
      render(
        <StageStatusBadge
          stage={3}
          status="running"
          action="stage3_started"
        />
      );

      expect(screen.getByText(/Stage 3:/)).toBeInTheDocument();
      expect(screen.getByText(/Implementation/)).toBeInTheDocument();
    });

    it('renders stage number and name for Stage 4', () => {
      render(
        <StageStatusBadge
          stage={4}
          status="running"
          action="stage4_started"
        />
      );

      expect(screen.getByText(/Stage 4:/)).toBeInTheDocument();
      expect(screen.getByText(/PR Creation/)).toBeInTheDocument();
    });

    it('renders stage number and name for Stage 5', () => {
      render(
        <StageStatusBadge
          stage={5}
          status="running"
          action="stage5_started"
        />
      );

      expect(screen.getByText(/Stage 5:/)).toBeInTheDocument();
      expect(screen.getByText(/PR Review/)).toBeInTheDocument();
    });

    it('renders stage number and name for Stage 6', () => {
      render(
        <StageStatusBadge
          stage={6}
          status="idle"
          action="stage6_awaiting_approval"
        />
      );

      expect(screen.getByText(/Stage 6:/)).toBeInTheDocument();
      expect(screen.getByText(/Merge/)).toBeInTheDocument();
    });
  });

  describe('activity label display', () => {
    it('renders activity label from action string', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
          action="stage1_started"
        />
      );

      expect(screen.getByText('Analyzing codebase')).toBeInTheDocument();
    });

    it('renders activity label from subState when provided', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
          action="stage1_started"
          subState="spawning_agent"
        />
      );

      expect(screen.getByText('Starting Claude agent')).toBeInTheDocument();
    });

    it('displays arrow separator between stage and activity', () => {
      render(
        <StageStatusBadge
          stage={2}
          status="running"
          action="stage2_started"
        />
      );

      expect(screen.getByText('→')).toBeInTheDocument();
    });

    it('renders stepId when provided for Stage 3', () => {
      render(
        <StageStatusBadge
          stage={3}
          status="running"
          action="stage3_progress"
          stepId="step-5"
        />
      );

      expect(screen.getByText(/\[step-5\]/)).toBeInTheDocument();
    });
  });

  describe('status indicators', () => {
    it('shows spinner when status is running', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
          action="stage1_started"
        />
      );

      // Check for svg with animate-spin class
      const badge = screen.getByRole('status');
      const spinner = badge.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('shows error icon when status is error', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="error"
          action="stage1_spawn_error"
        />
      );

      // Error status should have error styling
      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('bg-red-600/20');
    });

    it('shows pulse indicator when waiting for user input', () => {
      render(
        <StageStatusBadge
          stage={3}
          status="idle"
          action="stage3_blocked"
        />
      );

      // Check for waiting state styling
      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('bg-amber-600/20');
    });

    it('shows idle indicator when idle without waiting action', () => {
      render(
        <StageStatusBadge
          stage={2}
          status="idle"
          action="stage2_complete"
        />
      );

      // Check for idle/gray styling
      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('bg-gray-600/20');
    });
  });

  describe('styling', () => {
    it('applies blue styling for running status', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
          action="stage1_started"
        />
      );

      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('bg-blue-600/20');
      expect(badge).toHaveClass('text-blue-300');
    });

    it('applies red styling for error status', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="error"
          action="stage1_error"
        />
      );

      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('bg-red-600/20');
      expect(badge).toHaveClass('text-red-300');
    });

    it('applies amber styling for waiting actions', () => {
      render(
        <StageStatusBadge
          stage={5}
          status="idle"
          action="stage5_awaiting_user"
        />
      );

      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('bg-amber-600/20');
      expect(badge).toHaveClass('text-amber-300');
    });

    it('applies gray styling for idle status', () => {
      render(
        <StageStatusBadge
          stage={2}
          status="idle"
          action="stage2_complete"
        />
      );

      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('bg-gray-600/20');
      expect(badge).toHaveClass('text-gray-300');
    });

    it('accepts additional className prop', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
          action="stage1_started"
          className="custom-class"
        />
      );

      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('has role="status" for screen readers', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
          action="stage1_started"
        />
      );

      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has aria-label with stage and activity info', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
          action="stage1_started"
        />
      );

      const badge = screen.getByRole('status');
      expect(badge).toHaveAttribute('aria-label');
      expect(badge.getAttribute('aria-label')).toContain('Stage 1');
      expect(badge.getAttribute('aria-label')).toContain('Discovery');
    });
  });

  describe('edge cases', () => {
    it('handles missing action gracefully', () => {
      render(
        <StageStatusBadge
          stage={1}
          status="running"
        />
      );

      expect(screen.getByText(/Stage 1:/)).toBeInTheDocument();
      expect(screen.getByText(/Discovery/)).toBeInTheDocument();
      // Should not show activity arrow without action
      expect(screen.queryByText('→')).not.toBeInTheDocument();
    });

    it('handles unknown action with stage fallback', () => {
      render(
        <StageStatusBadge
          stage={2}
          status="running"
          action="unknown_custom_action"
        />
      );

      // Should show formatted action or stage-based fallback
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });
});
