import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ValidationActionBadge, QuestionStatusBadge } from './StatusBadges';

describe('ValidationActionBadge', () => {
  it('renders "Passed" with green styling for pass action', () => {
    render(<ValidationActionBadge action="pass" />);
    const badge = screen.getByText('Passed');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-green-600');
  });

  it('renders "Filtered" with red styling for filter action', () => {
    render(<ValidationActionBadge action="filter" />);
    const badge = screen.getByText('Filtered');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-red-600');
  });

  it('renders "Repurposed" with amber styling for repurpose action', () => {
    render(<ValidationActionBadge action="repurpose" />);
    const badge = screen.getByText('Repurposed');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-amber-600');
  });
});

describe('QuestionStatusBadge', () => {
  it('renders "Pending" with amber styling and pulse animation', () => {
    render(<QuestionStatusBadge status="pending" />);
    const badge = screen.getByText('Pending');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-amber-600/30');
    // Check for the pulsing indicator
    const pulseIndicator = badge.querySelector('.animate-pulse');
    expect(pulseIndicator).toBeInTheDocument();
  });

  it('renders "Answered" with green styling and checkmark', () => {
    render(<QuestionStatusBadge status="answered" />);
    const badge = screen.getByText('Answered');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-green-600/30');
    // Check for the checkmark SVG
    const svg = badge.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
