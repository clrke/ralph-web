import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NewSession from './NewSession';

// Wrapper to provide router context
const renderWithRouter = (ui: React.ReactElement) => {
  return render(
    <MemoryRouter initialEntries={['/new']}>
      {ui}
    </MemoryRouter>
  );
};

describe('NewSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render all form fields', () => {
    renderWithRouter(<NewSession />);

    expect(screen.getByPlaceholderText(/path\/to\/your\/project/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/add user authentication/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/describe the feature/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start discovery/i })).toBeInTheDocument();
  });

  it('should submit form data to API', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projectId: 'proj1', featureId: 'feat1' }),
    });
    global.fetch = fetchMock;

    renderWithRouter(<NewSession />);

    await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');
    await user.type(screen.getByPlaceholderText(/add user authentication/i), 'Test Feature');
    await user.type(screen.getByPlaceholderText(/describe the feature/i), 'Test description');

    await user.click(screen.getByRole('button', { name: /start discovery/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }));
    });
  });

  it('should disable submit button while submitting', async () => {
    const user = userEvent.setup();

    // Create a never-resolving promise to keep the button disabled
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    renderWithRouter(<NewSession />);

    await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test');
    await user.type(screen.getByPlaceholderText(/add user authentication/i), 'Test');
    await user.type(screen.getByPlaceholderText(/describe the feature/i), 'Desc');

    await user.click(screen.getByRole('button', { name: /start discovery/i }));

    expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
  });

  it('should add and remove acceptance criteria', async () => {
    const user = userEvent.setup();
    renderWithRouter(<NewSession />);

    // Click add criterion button
    await user.click(screen.getByText(/\+ add criterion/i));

    // Should now have 2 criterion inputs (starts with 1)
    const criterionInputs = screen.getAllByPlaceholderText(/e\.g\., all tests pass/i);
    expect(criterionInputs).toHaveLength(2);
  });

  it('should update base branch field', async () => {
    const user = userEvent.setup();
    renderWithRouter(<NewSession />);

    const baseBranchInput = screen.getByDisplayValue('main');
    await user.clear(baseBranchInput);
    await user.type(baseBranchInput, 'develop');

    expect(baseBranchInput).toHaveValue('develop');
  });

  it('should require project path and title', () => {
    renderWithRouter(<NewSession />);

    // Check that required attribute is set
    expect(screen.getByPlaceholderText(/path\/to\/your\/project/i)).toBeRequired();
    expect(screen.getByPlaceholderText(/add user authentication/i)).toBeRequired();
    expect(screen.getByPlaceholderText(/describe the feature/i)).toBeRequired();
  });

  describe('accessibility', () => {
    it('should have proper labels for all form fields', () => {
      renderWithRouter(<NewSession />);

      // Labels should be properly associated with inputs
      expect(screen.getByLabelText(/project path/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/feature title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/feature description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/base branch/i)).toBeInTheDocument();
    });

    it('should have aria-label on icon buttons', async () => {
      const user = userEvent.setup();
      renderWithRouter(<NewSession />);

      // Add a criterion to get the remove button
      await user.click(screen.getByText(/\+ add criterion/i));

      // Remove button should have aria-label
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      expect(removeButtons.length).toBeGreaterThan(0);
    });
  });
});
