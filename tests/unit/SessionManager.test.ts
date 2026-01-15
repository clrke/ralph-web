import { SessionManager } from '../../server/src/services/SessionManager';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { CreateSessionInput, Session } from '../../shared/types/session';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('SessionManager', () => {
  let manager: SessionManager;
  let storage: FileStorageService;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `test-sessions-${Date.now()}`);
    await fs.ensureDir(testDir);
    storage = new FileStorageService(testDir);
    manager = new SessionManager(storage);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('getProjectId', () => {
    it('should return MD5 hash of project path', () => {
      const projectPath = '/Users/arke/Projects/my-app';
      const projectId = manager.getProjectId(projectPath);

      expect(projectId).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should return same hash for same path', () => {
      const projectPath = '/Users/arke/Projects/my-app';
      const id1 = manager.getProjectId(projectPath);
      const id2 = manager.getProjectId(projectPath);

      expect(id1).toBe(id2);
    });

    it('should return different hash for different paths', () => {
      const id1 = manager.getProjectId('/path/one');
      const id2 = manager.getProjectId('/path/two');

      expect(id1).not.toBe(id2);
    });
  });

  describe('getFeatureId', () => {
    it('should slugify feature title', () => {
      const title = 'Add User Authentication';
      const featureId = manager.getFeatureId(title);

      expect(featureId).toBe('add-user-authentication');
    });

    it('should handle special characters', () => {
      const title = "Fix Bug #123: Can't Login!";
      const featureId = manager.getFeatureId(title);

      expect(featureId).toBe('fix-bug-123-cant-login');
    });

    it('should lowercase the result', () => {
      const title = 'UPPERCASE Title';
      const featureId = manager.getFeatureId(title);

      expect(featureId).toBe('uppercase-title');
    });

    it('should throw for empty title', () => {
      expect(() => manager.getFeatureId('')).toThrow(/alphanumeric/i);
    });

    it('should throw for title with only special characters', () => {
      expect(() => manager.getFeatureId('!@#$%^&*()')).toThrow(/alphanumeric/i);
    });

    it('should truncate very long titles to 64 chars', () => {
      const longTitle = 'a'.repeat(100);
      expect(manager.getFeatureId(longTitle).length).toBeLessThanOrEqual(64);
    });

    it('should remove leading and trailing dashes', () => {
      expect(manager.getFeatureId('--test--')).toBe('test');
    });

    it('should handle whitespace-only title', () => {
      expect(() => manager.getFeatureId('   ')).toThrow(/alphanumeric/i);
    });
  });

  describe('createSession', () => {
    const validInput: CreateSessionInput = {
      title: 'Add user authentication',
      featureDescription: 'Implement JWT-based auth',
      projectPath: '/Users/arke/Projects/my-app',
    };

    it('should create session with all required files', async () => {
      const session = await manager.createSession(validInput);

      expect(session.id).toBeDefined();
      expect(session.title).toBe(validInput.title);
      expect(session.projectId).toBe(manager.getProjectId(validInput.projectPath));
      expect(session.featureId).toBe(manager.getFeatureId(validInput.title));
      expect(session.status).toBe('discovery');
      expect(session.currentStage).toBe(1);
    });

    it('should create session directory structure', async () => {
      const session = await manager.createSession(validInput);
      const sessionDir = path.join(testDir, session.projectId, session.featureId);

      expect(await fs.pathExists(path.join(sessionDir, 'session.json'))).toBe(true);
      expect(await fs.pathExists(path.join(sessionDir, 'plan.json'))).toBe(true);
      expect(await fs.pathExists(path.join(sessionDir, 'questions.json'))).toBe(true);
      expect(await fs.pathExists(path.join(sessionDir, 'status.json'))).toBe(true);
    });

    it('should update projects.json index', async () => {
      const session = await manager.createSession(validInput);
      const projectsIndex = await storage.readJson<Record<string, string>>('projects.json');

      expect(projectsIndex).not.toBeNull();
      expect(projectsIndex![session.projectId]).toBe(validInput.projectPath);
    });

    it('should set default values for optional fields', async () => {
      const session = await manager.createSession(validInput);

      expect(session.acceptanceCriteria).toEqual([]);
      expect(session.affectedFiles).toEqual([]);
      expect(session.technicalNotes).toBe('');
      expect(session.baseBranch).toBe('main');
    });

    it('should use provided optional values', async () => {
      const inputWithOptional: CreateSessionInput = {
        ...validInput,
        acceptanceCriteria: [{ text: 'All tests pass', checked: false, type: 'automated' }],
        affectedFiles: ['src/auth.ts'],
        technicalNotes: 'Use JWT',
        baseBranch: 'develop',
      };

      const session = await manager.createSession(inputWithOptional);

      expect(session.acceptanceCriteria).toHaveLength(1);
      expect(session.affectedFiles).toContain('src/auth.ts');
      expect(session.technicalNotes).toBe('Use JWT');
      expect(session.baseBranch).toBe('develop');
    });

    it('should throw for empty title', async () => {
      await expect(
        manager.createSession({ ...validInput, title: '' })
      ).rejects.toThrow(/title is required/i);
    });

    it('should throw for empty projectPath', async () => {
      await expect(
        manager.createSession({ ...validInput, projectPath: '' })
      ).rejects.toThrow(/project path is required/i);
    });

    it('should throw for whitespace-only title', async () => {
      await expect(
        manager.createSession({ ...validInput, title: '   ' })
      ).rejects.toThrow(/title is required/i);
    });

    it('should throw when creating duplicate session', async () => {
      await manager.createSession(validInput);
      await expect(manager.createSession(validInput)).rejects.toThrow(/already exists/i);
    });

    it('should throw when titles normalize to same featureId', async () => {
      await manager.createSession(validInput);
      await expect(
        manager.createSession({ ...validInput, title: 'ADD USER AUTHENTICATION!' })
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe('getSession', () => {
    it('should retrieve existing session', async () => {
      const input: CreateSessionInput = {
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/path',
      };

      const created = await manager.createSession(input);
      const retrieved = await manager.getSession(created.projectId, created.featureId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.title).toBe(created.title);
    });

    it('should return null for non-existent session', async () => {
      const session = await manager.getSession('nonexistent', 'session');

      expect(session).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('should update session fields', async () => {
      const input: CreateSessionInput = {
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/path',
      };

      const session = await manager.createSession(input);
      const updated = await manager.updateSession(session.projectId, session.featureId, {
        status: 'planning',
        currentStage: 2,
      });

      expect(updated.status).toBe('planning');
      expect(updated.currentStage).toBe(2);
      expect(updated.updatedAt).not.toBe(session.updatedAt);
    });

    it('should throw for non-existent session', async () => {
      await expect(
        manager.updateSession('nonexistent', 'session', { status: 'planning' })
      ).rejects.toThrow();
    });

    it('should not allow updating protected fields', async () => {
      const input: CreateSessionInput = {
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/path',
      };

      const session = await manager.createSession(input);
      const updated = await manager.updateSession(session.projectId, session.featureId, {
        id: 'hacked-id',
        projectId: 'hacked-project',
        featureId: 'hacked-feature',
        createdAt: '1970-01-01T00:00:00.000Z',
        version: '9.9',
      } as Partial<Session>);

      // Protected fields should remain unchanged
      expect(updated.id).toBe(session.id);
      expect(updated.projectId).toBe(session.projectId);
      expect(updated.featureId).toBe(session.featureId);
      expect(updated.createdAt).toBe(session.createdAt);
      expect(updated.version).toBe(session.version);
    });
  });

  describe('listSessions', () => {
    it('should list all sessions for a project', async () => {
      const projectPath = '/test/project';

      await manager.createSession({
        title: 'Feature One',
        featureDescription: 'First feature',
        projectPath,
      });

      await manager.createSession({
        title: 'Feature Two',
        featureDescription: 'Second feature',
        projectPath,
      });

      const projectId = manager.getProjectId(projectPath);
      const sessions = await manager.listSessions(projectId);

      expect(sessions).toHaveLength(2);
    });

    it('should return empty array for project with no sessions', async () => {
      const sessions = await manager.listSessions('nonexistent-project');

      expect(sessions).toEqual([]);
    });
  });

  describe('transitionStage', () => {
    it('should transition from Stage 1 to Stage 2', async () => {
      const session = await manager.createSession({
        title: 'Test',
        featureDescription: 'Test',
        projectPath: '/test',
      });

      const updated = await manager.transitionStage(session.projectId, session.featureId, 2);

      expect(updated.currentStage).toBe(2);
      expect(updated.status).toBe('planning');
    });

    it('should validate stage transitions', async () => {
      const session = await manager.createSession({
        title: 'Test',
        featureDescription: 'Test',
        projectPath: '/test',
      });

      // Can't skip from Stage 1 to Stage 3
      await expect(
        manager.transitionStage(session.projectId, session.featureId, 3)
      ).rejects.toThrow();
    });

    it('should transition from Stage 6 to Stage 7 (completion)', async () => {
      const session = await manager.createSession({
        title: 'Stage 7 Test',
        featureDescription: 'Test',
        projectPath: '/test',
      });

      // Progress through stages 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
      await manager.transitionStage(session.projectId, session.featureId, 2);
      await manager.transitionStage(session.projectId, session.featureId, 3);
      await manager.transitionStage(session.projectId, session.featureId, 4);
      await manager.transitionStage(session.projectId, session.featureId, 5);
      await manager.transitionStage(session.projectId, session.featureId, 6);

      const completed = await manager.transitionStage(session.projectId, session.featureId, 7);

      expect(completed.currentStage).toBe(7);
      expect(completed.status).toBe('completed');
    });

    it('should not allow transitions from Stage 7 (terminal state)', async () => {
      const session = await manager.createSession({
        title: 'Terminal Test',
        featureDescription: 'Test',
        projectPath: '/test',
      });

      // Progress to Stage 7
      await manager.transitionStage(session.projectId, session.featureId, 2);
      await manager.transitionStage(session.projectId, session.featureId, 3);
      await manager.transitionStage(session.projectId, session.featureId, 4);
      await manager.transitionStage(session.projectId, session.featureId, 5);
      await manager.transitionStage(session.projectId, session.featureId, 6);
      await manager.transitionStage(session.projectId, session.featureId, 7);

      // Can't transition from Stage 7
      await expect(
        manager.transitionStage(session.projectId, session.featureId, 6)
      ).rejects.toThrow(/invalid stage transition/i);
    });
  });

  describe('validateProjectPath', () => {
    let validProjectDir: string;

    beforeEach(async () => {
      // Create a valid project directory with .git folder
      validProjectDir = path.join(os.tmpdir(), `test-project-${Date.now()}`);
      await fs.ensureDir(validProjectDir);
      await fs.ensureDir(path.join(validProjectDir, '.git'));
    });

    afterEach(async () => {
      await fs.remove(validProjectDir);
    });

    it('should validate a valid project path', async () => {
      await expect(manager.validateProjectPath(validProjectDir)).resolves.not.toThrow();
    });

    it('should throw for non-existent path', async () => {
      await expect(
        manager.validateProjectPath('/nonexistent/path/that/does/not/exist')
      ).rejects.toThrow(/does not exist/i);
    });

    it('should throw for path that is a file, not directory', async () => {
      const filePath = path.join(validProjectDir, 'somefile.txt');
      await fs.writeFile(filePath, 'content');

      await expect(manager.validateProjectPath(filePath)).rejects.toThrow(/not a directory/i);
    });

    it('should throw for path that is not a git repository', async () => {
      const nonGitDir = path.join(os.tmpdir(), `non-git-${Date.now()}`);
      await fs.ensureDir(nonGitDir);

      try {
        await expect(manager.validateProjectPath(nonGitDir)).rejects.toThrow(/not a git repository/i);
      } finally {
        await fs.remove(nonGitDir);
      }
    });

    it('should throw for path without read access', async () => {
      // Skip on Windows where chmod doesn't work the same way
      if (process.platform === 'win32') {
        return;
      }

      const noReadDir = path.join(os.tmpdir(), `no-read-${Date.now()}`);
      await fs.ensureDir(noReadDir);
      await fs.ensureDir(path.join(noReadDir, '.git'));
      await fs.chmod(noReadDir, 0o000);

      try {
        await expect(manager.validateProjectPath(noReadDir)).rejects.toThrow(/cannot read/i);
      } finally {
        await fs.chmod(noReadDir, 0o755);
        await fs.remove(noReadDir);
      }
    });

    it('should throw for path without write access', async () => {
      // Skip on Windows where chmod doesn't work the same way
      if (process.platform === 'win32') {
        return;
      }

      const noWriteDir = path.join(os.tmpdir(), `no-write-${Date.now()}`);
      await fs.ensureDir(noWriteDir);
      await fs.ensureDir(path.join(noWriteDir, '.git'));
      await fs.chmod(noWriteDir, 0o444);

      try {
        await expect(manager.validateProjectPath(noWriteDir)).rejects.toThrow(/cannot write/i);
      } finally {
        await fs.chmod(noWriteDir, 0o755);
        await fs.remove(noWriteDir);
      }
    });
  });

  describe('createSession with path validation', () => {
    let validProjectDir: string;
    let validatingManager: SessionManager;

    beforeEach(async () => {
      // Create a valid project directory with .git folder
      validProjectDir = path.join(os.tmpdir(), `test-validated-project-${Date.now()}`);
      await fs.ensureDir(validProjectDir);
      await fs.ensureDir(path.join(validProjectDir, '.git'));

      // Create a manager with validation enabled
      validatingManager = new SessionManager(storage, { validateProjectPath: true });
    });

    afterEach(async () => {
      await fs.remove(validProjectDir);
    });

    it('should create session for valid project path when validation enabled', async () => {
      const session = await validatingManager.createSession({
        title: 'Valid Project Feature',
        featureDescription: 'Test',
        projectPath: validProjectDir,
      });

      expect(session.projectPath).toBe(validProjectDir);
    });

    it('should throw for invalid project path when validation enabled', async () => {
      await expect(
        validatingManager.createSession({
          title: 'Invalid Path Feature',
          featureDescription: 'Test',
          projectPath: '/nonexistent/path',
        })
      ).rejects.toThrow(/does not exist/i);
    });

    it('should throw for non-git directory when validation enabled', async () => {
      const nonGitDir = path.join(os.tmpdir(), `non-git-create-${Date.now()}`);
      await fs.ensureDir(nonGitDir);

      try {
        await expect(
          validatingManager.createSession({
            title: 'Non Git Feature',
            featureDescription: 'Test',
            projectPath: nonGitDir,
          })
        ).rejects.toThrow(/not a git repository/i);
      } finally {
        await fs.remove(nonGitDir);
      }
    });
  });

  describe('getGitInfo', () => {
    it('should return null for non-git directory', async () => {
      const nonGitDir = path.join(os.tmpdir(), `non-git-info-${Date.now()}`);
      await fs.ensureDir(nonGitDir);

      try {
        const info = await manager.getGitInfo(nonGitDir);
        expect(info).toBeNull();
      } finally {
        await fs.remove(nonGitDir);
      }
    });

    it('should return git info for a valid git repository', async () => {
      // Use the actual project directory which is a git repo
      const projectDir = path.resolve(__dirname, '../..');
      const info = await manager.getGitInfo(projectDir);

      expect(info).not.toBeNull();
      expect(info?.currentBranch).toBeDefined();
      expect(info?.headCommitSha).toBeDefined();
      // SHA should be 40 hex characters
      expect(info?.headCommitSha).toMatch(/^[a-f0-9]{40}$/);
    });
  });

  describe('createSession with git info', () => {
    it('should populate baseCommitSha from git HEAD when path validation enabled', async () => {
      // Use the actual project directory
      const projectDir = path.resolve(__dirname, '../..');
      const gitManager = new SessionManager(storage, { validateProjectPath: true });

      const session = await gitManager.createSession({
        title: 'Git Info Test Feature',
        featureDescription: 'Testing git info population',
        projectPath: projectDir,
      });

      // baseCommitSha should be a valid git SHA
      expect(session.baseCommitSha).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should create featureBranch with feature/ prefix', async () => {
      const session = await manager.createSession({
        title: 'My Cool Feature',
        featureDescription: 'Test',
        projectPath: '/test/path',
      });

      expect(session.featureBranch).toBe('feature/my-cool-feature');
    });

    it('should handle special characters in feature branch name', async () => {
      const session = await manager.createSession({
        title: "Fix Bug #123: Can't Login!",
        featureDescription: 'Test',
        projectPath: '/test/path',
      });

      expect(session.featureBranch).toBe('feature/fix-bug-123-cant-login');
    });
  });

  describe('session queue management', () => {
    const projectPath = '/test/project';

    describe('getActiveSessionForProject', () => {
      it('should return null when no sessions exist', async () => {
        const projectId = manager.getProjectId(projectPath);
        const active = await manager.getActiveSessionForProject(projectId);

        expect(active).toBeNull();
      });

      it('should return active session when one exists', async () => {
        const session = await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);
        const active = await manager.getActiveSessionForProject(projectId);

        expect(active).not.toBeNull();
        expect(active!.id).toBe(session.id);
      });

      it('should not return completed sessions', async () => {
        const session = await manager.createSession({
          title: 'Completed Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.updateSession(session.projectId, session.featureId, {
          status: 'completed',
        });

        const active = await manager.getActiveSessionForProject(session.projectId);
        expect(active).toBeNull();
      });

      it('should not return queued sessions', async () => {
        const session = await manager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.updateSession(session.projectId, session.featureId, {
          status: 'queued',
          currentStage: 0,
        });

        const active = await manager.getActiveSessionForProject(session.projectId);
        expect(active).toBeNull();
      });
    });

    describe('createSession with queue', () => {
      it('should queue second session when active session exists', async () => {
        // Create first session
        const first = await manager.createSession({
          title: 'First Feature',
          featureDescription: 'Test',
          projectPath,
        });

        expect(first.status).toBe('discovery');
        expect(first.currentStage).toBe(1);
        expect(first.queuePosition).toBeNull();

        // Create second session - should be queued
        const second = await manager.createSession({
          title: 'Second Feature',
          featureDescription: 'Test',
          projectPath,
        });

        expect(second.status).toBe('queued');
        expect(second.currentStage).toBe(0);
        expect(second.queuePosition).toBe(1);
        expect(second.queuedAt).toBeDefined();
      });

      it('should set correct queue positions for multiple queued sessions', async () => {
        await manager.createSession({
          title: 'First Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const second = await manager.createSession({
          title: 'Second Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const third = await manager.createSession({
          title: 'Third Feature',
          featureDescription: 'Test',
          projectPath,
        });

        expect(second.queuePosition).toBe(1);
        expect(third.queuePosition).toBe(2);
      });
    });

    describe('getQueuedSessions', () => {
      it('should return empty array when no queued sessions', async () => {
        const projectId = manager.getProjectId(projectPath);
        const queued = await manager.getQueuedSessions(projectId);

        expect(queued).toEqual([]);
      });

      it('should return queued sessions sorted by position', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const second = await manager.createSession({
          title: 'Second Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const third = await manager.createSession({
          title: 'Third Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);
        const queued = await manager.getQueuedSessions(projectId);

        expect(queued).toHaveLength(2);
        expect(queued[0].id).toBe(second.id);
        expect(queued[1].id).toBe(third.id);
      });
    });

    describe('getNextQueuedSession', () => {
      it('should return null when no queued sessions', async () => {
        const projectId = manager.getProjectId(projectPath);
        const next = await manager.getNextQueuedSession(projectId);

        expect(next).toBeNull();
      });

      it('should return session with lowest queue position', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const second = await manager.createSession({
          title: 'Next in Queue',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Later in Queue',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);
        const next = await manager.getNextQueuedSession(projectId);

        expect(next).not.toBeNull();
        expect(next!.id).toBe(second.id);
      });
    });

    describe('startQueuedSession', () => {
      it('should transition queued session to discovery', async () => {
        // Create active and queued sessions
        const first = await manager.createSession({
          title: 'First Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const second = await manager.createSession({
          title: 'Second Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Complete first session
        await manager.updateSession(first.projectId, first.featureId, {
          status: 'completed',
        });

        // Start second session
        const started = await manager.startQueuedSession(second.projectId, second.featureId);

        expect(started.status).toBe('discovery');
        expect(started.currentStage).toBe(1);
        expect(started.queuePosition).toBeNull();
        expect(started.queuedAt).toBeNull();
      });

      it('should throw when session is not queued', async () => {
        const session = await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await expect(
          manager.startQueuedSession(session.projectId, session.featureId)
        ).rejects.toThrow(/not queued/i);
      });

      it('should throw when another session is still active', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const second = await manager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await expect(
          manager.startQueuedSession(second.projectId, second.featureId)
        ).rejects.toThrow(/another session is active/i);
      });
    });

    describe('recalculateQueuePositions', () => {
      it('should recalculate positions after session starts', async () => {
        const active = await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const second = await manager.createSession({
          title: 'Second Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const third = await manager.createSession({
          title: 'Third Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Complete active and start second
        await manager.updateSession(active.projectId, active.featureId, {
          status: 'completed',
        });
        await manager.startQueuedSession(second.projectId, second.featureId);
        await manager.recalculateQueuePositions(active.projectId);

        // Refresh third session
        const updatedThird = await manager.getSession(third.projectId, third.featureId);

        expect(updatedThird!.queuePosition).toBe(1); // Was 2, now 1
      });
    });
  });
});
