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

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/check-queue')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ activeSession: null, queuedCount: 0 }),
        });
      }
      if (url.includes('/preferences')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ projectId: 'proj1', featureId: 'feat1' }),
      });
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

    // Mock to return check-queue immediately, but never resolve session creation
    let sessionCallCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/check-queue')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ activeSession: null, queuedCount: 0 }),
        });
      }
      if (url.includes('/preferences')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      // First session call (the actual POST) - never resolve
      sessionCallCount++;
      if (sessionCallCount === 1) {
        return new Promise(() => {});
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ projectId: 'proj1', featureId: 'feat1' }),
      });
    });

    renderWithRouter(<NewSession />);

    await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test');
    await user.type(screen.getByPlaceholderText(/add user authentication/i), 'Test');
    await user.type(screen.getByPlaceholderText(/describe the feature/i), 'Desc');

    await user.click(screen.getByRole('button', { name: /start discovery/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
    });
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

  describe('button text', () => {
    it('should show "Start Discovery" when no active session exists', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ activeSession: null, queuedCount: 0 }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({}),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      // Type in project path to trigger check-queue call
      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      // Wait for the debounced check-queue call to complete
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/check-queue'));
      }, { timeout: 1000 });

      // Button should show "Start Discovery"
      expect(screen.getByRole('button', { name: /start discovery/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /queue session/i })).not.toBeInTheDocument();
    });

    it('should show "Queue Session" when an active session exists', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              activeSession: { id: 'session-1', title: 'Active Feature', status: 'running' },
              queuedCount: 0,
            }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({}),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      // Type in project path to trigger check-queue call
      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      // Wait for the debounced check-queue call to complete
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/check-queue'));
      }, { timeout: 1000 });

      // Button should show "Queue Session"
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /queue session/i })).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /start discovery/i })).not.toBeInTheDocument();
    });
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

    it('should have autoComplete="off" on Feature Title input', () => {
      renderWithRouter(<NewSession />);

      const featureTitleInput = screen.getByLabelText(/feature title/i);
      expect(featureTitleInput).toHaveAttribute('autocomplete', 'off');
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

  describe('preferences', () => {
    it('should render collapsed preferences section by default', () => {
      renderWithRouter(<NewSession />);

      // Preferences button should be visible
      expect(screen.getByRole('button', { name: /preferences/i })).toBeInTheDocument();
      // But preference fields should not be visible
      expect(screen.queryByText(/risk comfort/i)).not.toBeInTheDocument();
    });

    it('should expand preferences section when clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<NewSession />);

      await user.click(screen.getByRole('button', { name: /preferences/i }));

      // All 5 preference fields should be visible
      expect(screen.getByText(/risk comfort/i)).toBeInTheDocument();
      expect(screen.getByText(/speed vs quality/i)).toBeInTheDocument();
      expect(screen.getByText(/scope flexibility/i)).toBeInTheDocument();
      expect(screen.getByText(/detail level/i)).toBeInTheDocument();
      expect(screen.getByText(/autonomy level/i)).toBeInTheDocument();
    });

    it('should have Remember for this project checkbox checked by default', async () => {
      const user = userEvent.setup();
      renderWithRouter(<NewSession />);

      await user.click(screen.getByRole('button', { name: /preferences/i }));

      const checkbox = screen.getByRole('checkbox', { name: /remember for this project/i });
      expect(checkbox).toBeChecked();
    });

    it('should allow changing preference values', async () => {
      const user = userEvent.setup();
      renderWithRouter(<NewSession />);

      await user.click(screen.getByRole('button', { name: /preferences/i }));

      // Change risk comfort to 'high'
      const highRadio = screen.getByRole('radio', { name: /high/i });
      await user.click(highRadio);
      expect(highRadio).toBeChecked();

      // Change speed vs quality to 'quality'
      const qualityRadio = screen.getByRole('radio', { name: /quality/i });
      await user.click(qualityRadio);
      expect(qualityRadio).toBeChecked();
    });

    it('should load preferences when project path is entered', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ activeSession: null, queuedCount: 0 }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              riskComfort: 'high',
              speedVsQuality: 'quality',
              scopeFlexibility: 'open',
              detailLevel: 'detailed',
              autonomyLevel: 'autonomous',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      // Wait for debounced fetch (check-queue and preferences both get called)
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/preferences'));
      }, { timeout: 1000 });

      // Expand preferences and verify loaded values
      await user.click(screen.getByRole('button', { name: /preferences/i }));

      await waitFor(() => {
        expect(screen.getByRole('radio', { name: /high/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /quality/i })).toBeChecked();
      });
    });

    it('should save preferences on submit when checkbox is checked', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ activeSession: null, queuedCount: 0 }),
          });
        }
        if (url.includes('/preferences') && options?.method === 'PUT') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (url.includes('/preferences')) {
          // GET preferences - return defaults
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({}),
          });
        }
        // POST /api/sessions
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projectId: 'proj1', featureId: 'feat1' }),
        });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');
      await user.type(screen.getByPlaceholderText(/add user authentication/i), 'Test Feature');
      await user.type(screen.getByPlaceholderText(/describe the feature/i), 'Test description');

      await user.click(screen.getByRole('button', { name: /start discovery/i }));

      await waitFor(() => {
        // Should have called PUT to save preferences
        const putCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
          (call) => call[0].includes('/preferences') && call[1]?.method === 'PUT'
        );
        expect(putCalls.length).toBeGreaterThan(0);
      }, { timeout: 3000 });
    });

    it('should not save preferences on submit when checkbox is unchecked', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ activeSession: null, queuedCount: 0 }),
          });
        }
        if (url.includes('/preferences') && options?.method === 'GET') {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projectId: 'proj1', featureId: 'feat1' }),
        });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');
      await user.type(screen.getByPlaceholderText(/add user authentication/i), 'Test Feature');
      await user.type(screen.getByPlaceholderText(/describe the feature/i), 'Test description');

      // Expand and uncheck the remember checkbox
      await user.click(screen.getByRole('button', { name: /preferences/i }));
      await user.click(screen.getByRole('checkbox', { name: /remember for this project/i }));

      await user.click(screen.getByRole('button', { name: /start discovery/i }));

      await waitFor(() => {
        // Should NOT have called PUT to save preferences
        const putCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
          (call) => call[1]?.method === 'PUT'
        );
        expect(putCalls).toHaveLength(0);
      });
    });

    it('should include preferences in session creation request', async () => {
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

      // Expand preferences to change a value
      await user.click(screen.getByRole('button', { name: /preferences/i }));
      // Change riskComfort to 'high' to prove preferences are included
      await user.click(screen.getByRole('radio', { name: /high/i }));
      // Uncheck "remember" to avoid PUT call blocking
      await user.click(screen.getByRole('checkbox', { name: /remember for this project/i }));

      await user.click(screen.getByRole('button', { name: /start discovery/i }));

      await waitFor(() => {
        const sessionCall = (fetchMock.mock.calls as [string, RequestInit?][]).find(
          (call) => call[0] === '/api/sessions' && call[1]?.method === 'POST'
        );
        expect(sessionCall).toBeDefined();
        if (sessionCall) {
          const body = JSON.parse(sessionCall[1]?.body as string);
          // Preferences object should be included with the changed value
          expect(body).toHaveProperty('preferences');
          expect(body.preferences.riskComfort).toBe('high');
        }
      });
    });
  });

  describe('queue priority selector', () => {
    it('should not show priority selector when no active session exists', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ activeSession: null, queuedCount: 0 }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/check-queue'));
      }, { timeout: 1000 });

      // Priority selector should not be visible
      expect(screen.queryByTestId('queue-priority-front')).not.toBeInTheDocument();
      expect(screen.queryByTestId('queue-priority-end')).not.toBeInTheDocument();
    });

    it('should show priority selector when active session exists', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              activeSession: { id: 'session-1', title: 'Active Feature' },
              queuedCount: 2,
            }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/check-queue'));
      }, { timeout: 1000 });

      // Priority selector should be visible
      await waitFor(() => {
        expect(screen.getByTestId('queue-priority-front')).toBeInTheDocument();
        expect(screen.getByTestId('queue-priority-end')).toBeInTheDocument();
      });
    });

    it('should default to "End of queue"', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              activeSession: { id: 'session-1', title: 'Active Feature' },
              queuedCount: 0,
            }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      await waitFor(() => {
        expect(screen.getByTestId('queue-priority-end')).toBeInTheDocument();
      });

      // "End of queue" button should be highlighted (have the selected class)
      const endButton = screen.getByTestId('queue-priority-end');
      expect(endButton).toHaveClass('bg-yellow-600');
    });

    it('should allow selecting "Front of queue"', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              activeSession: { id: 'session-1', title: 'Active Feature' },
              queuedCount: 0,
            }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      await waitFor(() => {
        expect(screen.getByTestId('queue-priority-front')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('queue-priority-front'));

      // "Front of queue" button should now be highlighted
      const frontButton = screen.getByTestId('queue-priority-front');
      expect(frontButton).toHaveClass('bg-yellow-600');
    });

    it('should show position dropdown when queuedCount > 1', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              activeSession: { id: 'session-1', title: 'Active Feature' },
              queuedCount: 3,
            }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      await waitFor(() => {
        expect(screen.getByTestId('queue-priority-position')).toBeInTheDocument();
      });

      // Should have options for positions 1, 2, 3
      const select = screen.getByTestId('queue-priority-position');
      expect(select).toBeInTheDocument();
    });

    it('should not show position dropdown when queuedCount <= 1', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              activeSession: { id: 'session-1', title: 'Active Feature' },
              queuedCount: 1,
            }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      await waitFor(() => {
        expect(screen.getByTestId('queue-priority-front')).toBeInTheDocument();
      });

      // Position dropdown should not be visible
      expect(screen.queryByTestId('queue-priority-position')).not.toBeInTheDocument();
    });

    it('should include insertAtPosition in API call when session is queued', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              activeSession: { id: 'session-1', title: 'Active Feature' },
              queuedCount: 2,
            }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projectId: 'proj1', featureId: 'feat1' }),
        });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');

      await waitFor(() => {
        expect(screen.getByTestId('queue-priority-front')).toBeInTheDocument();
      });

      // Select "Front of queue"
      await user.click(screen.getByTestId('queue-priority-front'));

      // Fill required fields
      await user.type(screen.getByPlaceholderText(/add user authentication/i), 'Test Feature');
      await user.type(screen.getByPlaceholderText(/describe the feature/i), 'Test description');

      // Submit
      await user.click(screen.getByRole('button', { name: /queue session/i }));

      await waitFor(() => {
        const sessionCall = (fetchMock.mock.calls as [string, RequestInit?][]).find(
          (call) => call[0] === '/api/sessions' && call[1]?.method === 'POST'
        );
        expect(sessionCall).toBeDefined();
        if (sessionCall) {
          const body = JSON.parse(sessionCall[1]?.body as string);
          expect(body.insertAtPosition).toBe('front');
        }
      });
    });

    it('should not include insertAtPosition when no active session exists', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/check-queue')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ activeSession: null, queuedCount: 0 }),
          });
        }
        if (url.includes('/preferences')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projectId: 'proj1', featureId: 'feat1' }),
        });
      });
      global.fetch = fetchMock;

      renderWithRouter(<NewSession />);

      await user.type(screen.getByPlaceholderText(/path\/to\/your\/project/i), '/test/project');
      await user.type(screen.getByPlaceholderText(/add user authentication/i), 'Test Feature');
      await user.type(screen.getByPlaceholderText(/describe the feature/i), 'Test description');

      await user.click(screen.getByRole('button', { name: /start discovery/i }));

      await waitFor(() => {
        const sessionCall = (fetchMock.mock.calls as [string, RequestInit?][]).find(
          (call) => call[0] === '/api/sessions' && call[1]?.method === 'POST'
        );
        expect(sessionCall).toBeDefined();
        if (sessionCall) {
          const body = JSON.parse(sessionCall[1]?.body as string);
          expect(body.insertAtPosition).toBeUndefined();
        }
      });
    });
  });
});
