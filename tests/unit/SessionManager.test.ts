import { SessionManager, BackoutResult, ResumeResult } from '../../server/src/services/SessionManager';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { CreateSessionInput, Session, UserPreferences, DEFAULT_USER_PREFERENCES, BackoutReason } from '../../shared/types/session';
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

    it('should create session with provided preferences', async () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      const session = await manager.createSession(validInput, customPrefs);

      expect(session.preferences).toEqual(customPrefs);
    });

    it('should create session without preferences when not provided', async () => {
      const session = await manager.createSession(validInput);

      expect(session.preferences).toBeUndefined();
    });

    it('should persist preferences in session.json', async () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'low',
        speedVsQuality: 'speed',
        scopeFlexibility: 'fixed',
        detailLevel: 'minimal',
        autonomyLevel: 'guided',
      };

      const session = await manager.createSession(validInput, customPrefs);
      const sessionDir = path.join(testDir, session.projectId, session.featureId);
      const savedSession = await fs.readJson(path.join(sessionDir, 'session.json'));

      expect(savedSession.preferences).toEqual(customPrefs);
    });

    it('should create session with default preferences when passed explicitly', async () => {
      const session = await manager.createSession(validInput, DEFAULT_USER_PREFERENCES);

      expect(session.preferences).toEqual(DEFAULT_USER_PREFERENCES);
      expect(session.preferences?.riskComfort).toBe('medium');
      expect(session.preferences?.speedVsQuality).toBe('balanced');
      expect(session.preferences?.scopeFlexibility).toBe('flexible');
      expect(session.preferences?.detailLevel).toBe('standard');
      expect(session.preferences?.autonomyLevel).toBe('collaborative');
    });

    it('should use input.preferences when provided in input', async () => {
      const inputPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      const session = await manager.createSession({
        ...validInput,
        title: 'Input Prefs Test',
        preferences: inputPrefs,
      });

      expect(session.preferences).toEqual(inputPrefs);
    });

    it('should prioritize input.preferences over projectPreferences parameter', async () => {
      const inputPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      const projectPrefs: UserPreferences = {
        riskComfort: 'low',
        speedVsQuality: 'speed',
        scopeFlexibility: 'fixed',
        detailLevel: 'minimal',
        autonomyLevel: 'guided',
      };

      const session = await manager.createSession(
        {
          ...validInput,
          title: 'Priority Test',
          preferences: inputPrefs,
        },
        projectPrefs
      );

      // input.preferences should take priority
      expect(session.preferences).toEqual(inputPrefs);
    });

    it('should use projectPreferences when input.preferences is not provided', async () => {
      const projectPrefs: UserPreferences = {
        riskComfort: 'low',
        speedVsQuality: 'speed',
        scopeFlexibility: 'fixed',
        detailLevel: 'minimal',
        autonomyLevel: 'guided',
      };

      const session = await manager.createSession(
        {
          ...validInput,
          title: 'Project Prefs Test',
        },
        projectPrefs
      );

      expect(session.preferences).toEqual(projectPrefs);
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

    describe('stage transition validation', () => {
      it('should allow valid stage transition from 1 to 2', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        const updated = await manager.updateSession(session.projectId, session.featureId, {
          currentStage: 2,
        });

        expect(updated.currentStage).toBe(2);
      });

      it('should allow valid stage transition from 5 to 6', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        // Progress session to stage 5
        await manager.transitionStage(session.projectId, session.featureId, 2);
        await manager.transitionStage(session.projectId, session.featureId, 3);
        await manager.transitionStage(session.projectId, session.featureId, 4);
        await manager.transitionStage(session.projectId, session.featureId, 5);

        // Now try to update to stage 6 via updateSession
        const updated = await manager.updateSession(session.projectId, session.featureId, {
          currentStage: 6,
        });

        expect(updated.currentStage).toBe(6);
      });

      it('should allow valid stage transition from 6 to 7', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        // Progress session to stage 6
        await manager.transitionStage(session.projectId, session.featureId, 2);
        await manager.transitionStage(session.projectId, session.featureId, 3);
        await manager.transitionStage(session.projectId, session.featureId, 4);
        await manager.transitionStage(session.projectId, session.featureId, 5);
        await manager.transitionStage(session.projectId, session.featureId, 6);

        // Now try to update to stage 7 via updateSession
        const updated = await manager.updateSession(session.projectId, session.featureId, {
          currentStage: 7,
        });

        expect(updated.currentStage).toBe(7);
      });

      it('should reject invalid stage transition from 1 to 3 (skipping stage 2)', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        await expect(
          manager.updateSession(session.projectId, session.featureId, {
            currentStage: 3,
          })
        ).rejects.toThrow(/invalid stage transition/i);
      });

      it('should reject invalid stage transition from 1 to 7 (skipping all stages)', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        await expect(
          manager.updateSession(session.projectId, session.featureId, {
            currentStage: 7,
          })
        ).rejects.toThrow(/invalid stage transition/i);
      });

      it('should reject transition from terminal stage 7', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        // Progress to stage 7
        await manager.transitionStage(session.projectId, session.featureId, 2);
        await manager.transitionStage(session.projectId, session.featureId, 3);
        await manager.transitionStage(session.projectId, session.featureId, 4);
        await manager.transitionStage(session.projectId, session.featureId, 5);
        await manager.transitionStage(session.projectId, session.featureId, 6);
        await manager.transitionStage(session.projectId, session.featureId, 7);

        // Try to go back to stage 2
        await expect(
          manager.updateSession(session.projectId, session.featureId, {
            currentStage: 2,
          })
        ).rejects.toThrow(/invalid stage transition.*terminal/i);
      });

      it('should allow transition from queued (stage 0) to discovery (stage 1)', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        // Put session in queued state (stage 0)
        await manager.updateSession(session.projectId, session.featureId, {
          currentStage: 0,
          status: 'queued',
        });

        // Now start the session (stage 0 -> 1)
        const updated = await manager.updateSession(session.projectId, session.featureId, {
          currentStage: 1,
          status: 'discovery',
        });

        expect(updated.currentStage).toBe(1);
      });

      it('should allow transition to queued (stage 0) from any stage', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        // Progress to stage 2
        await manager.transitionStage(session.projectId, session.featureId, 2);

        // Queue the session (any stage -> 0)
        const updated = await manager.updateSession(session.projectId, session.featureId, {
          currentStage: 0,
          status: 'queued',
        });

        expect(updated.currentStage).toBe(0);
      });

      it('should allow updating non-stage fields without triggering validation', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        // Update other fields without changing stage
        const updated = await manager.updateSession(session.projectId, session.featureId, {
          technicalNotes: 'Updated notes',
        });

        expect(updated.technicalNotes).toBe('Updated notes');
        expect(updated.currentStage).toBe(1); // Unchanged
      });

      it('should allow updating same stage (no transition)', async () => {
        const session = await manager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/path',
        });

        // Update to same stage
        const updated = await manager.updateSession(session.projectId, session.featureId, {
          currentStage: 1,
        });

        expect(updated.currentStage).toBe(1);
      });
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

      it('should insert at front of queue when insertAtPosition is "front"', async () => {
        await manager.createSession({
          title: 'First Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Second Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Insert at front - should become position 1
        const third = await manager.createSession({
          title: 'Third Feature',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 'front',
        });

        expect(third.queuePosition).toBe(1);

        // Verify other sessions were shifted
        const projectId = manager.getProjectId(projectPath);
        const queued = await manager.getQueuedSessions(projectId);
        expect(queued).toHaveLength(2);
        expect(queued[0].title).toBe('Third Feature');
        expect(queued[0].queuePosition).toBe(1);
        expect(queued[1].title).toBe('Second Feature');
        expect(queued[1].queuePosition).toBe(2);
      });

      it('should insert at end of queue when insertAtPosition is "end"', async () => {
        await manager.createSession({
          title: 'First Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Second Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Insert at end - should become position 2
        const third = await manager.createSession({
          title: 'Third Feature',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 'end',
        });

        expect(third.queuePosition).toBe(2);

        // Verify other sessions weren't shifted
        const projectId = manager.getProjectId(projectPath);
        const queued = await manager.getQueuedSessions(projectId);
        expect(queued).toHaveLength(2);
        expect(queued[0].title).toBe('Second Feature');
        expect(queued[0].queuePosition).toBe(1);
        expect(queued[1].title).toBe('Third Feature');
        expect(queued[1].queuePosition).toBe(2);
      });

      it('should insert at specific position and shift others', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Create queued sessions
        await manager.createSession({
          title: 'Queue Position 1',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Queue Position 2',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Queue Position 3',
          featureDescription: 'Test',
          projectPath,
        });

        // Insert at position 2
        const inserted = await manager.createSession({
          title: 'Inserted at Position 2',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 2,
        });

        expect(inserted.queuePosition).toBe(2);

        // Verify positions
        const projectId = manager.getProjectId(projectPath);
        const queued = await manager.getQueuedSessions(projectId);
        expect(queued).toHaveLength(4);
        expect(queued[0].title).toBe('Queue Position 1');
        expect(queued[0].queuePosition).toBe(1);
        expect(queued[1].title).toBe('Inserted at Position 2');
        expect(queued[1].queuePosition).toBe(2);
        expect(queued[2].title).toBe('Queue Position 2');
        expect(queued[2].queuePosition).toBe(3);
        expect(queued[3].title).toBe('Queue Position 3');
        expect(queued[3].queuePosition).toBe(4);
      });

      it('should clamp position to valid range', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Insert at position 999 (beyond queue length) - should be clamped to end
        const inserted = await manager.createSession({
          title: 'Inserted Feature',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 999,
        });

        expect(inserted.queuePosition).toBe(2);
      });

      it('should ignore insertAtPosition when session is not queued', async () => {
        // First session shouldn't be queued, so insertAtPosition should be ignored
        const session = await manager.createSession({
          title: 'First Feature',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 'front',
        });

        expect(session.status).toBe('discovery');
        expect(session.queuePosition).toBeNull();
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

      it('should respect priority after reordering queue', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const first = await manager.createSession({
          title: 'Originally First',
          featureDescription: 'Test',
          projectPath,
        });

        const second = await manager.createSession({
          title: 'Originally Second',
          featureDescription: 'Test',
          projectPath,
        });

        const third = await manager.createSession({
          title: 'Originally Third',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);

        // Reorder: third becomes highest priority
        await manager.reorderQueuedSessions(projectId, [
          third.featureId,
          second.featureId,
          first.featureId,
        ]);

        const next = await manager.getNextQueuedSession(projectId);
        expect(next).not.toBeNull();
        expect(next!.title).toBe('Originally Third');
        expect(next!.queuePosition).toBe(1);
      });

      it('should respect priority when session inserted at front', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Original First in Queue',
          featureDescription: 'Test',
          projectPath,
        });

        // Insert new session at front
        const frontSession = await manager.createSession({
          title: 'Inserted at Front',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 'front',
        });

        const projectId = manager.getProjectId(projectPath);
        const next = await manager.getNextQueuedSession(projectId);

        expect(next).not.toBeNull();
        expect(next!.id).toBe(frontSession.id);
        expect(next!.title).toBe('Inserted at Front');
        expect(next!.queuePosition).toBe(1);
      });

      it('should handle null queuePosition values gracefully', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const queued = await manager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);

        // Manually set queuePosition to null to test edge case
        await manager.updateSession(projectId, queued.featureId, {
          queuePosition: null,
        });

        // Create another queued session with valid position
        const another = await manager.createSession({
          title: 'Another Queued',
          featureDescription: 'Test',
          projectPath,
        });

        const next = await manager.getNextQueuedSession(projectId);

        // Session with valid queuePosition should be returned first
        expect(next).not.toBeNull();
        expect(next!.id).toBe(another.id);
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

      it('should maintain relative order when recalculating after reorder', async () => {
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

        const fourth = await manager.createSession({
          title: 'Fourth Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);

        // Reorder: fourth, third, second
        await manager.reorderQueuedSessions(projectId, [
          fourth.featureId,
          third.featureId,
          second.featureId,
        ]);

        // Complete active and start the highest priority (fourth)
        await manager.updateSession(active.projectId, active.featureId, {
          status: 'completed',
        });
        await manager.startQueuedSession(projectId, fourth.featureId);
        await manager.recalculateQueuePositions(projectId);

        // Verify relative order maintained: third=1, second=2
        const queued = await manager.getQueuedSessions(projectId);
        expect(queued).toHaveLength(2);
        expect(queued[0].featureId).toBe(third.featureId);
        expect(queued[0].queuePosition).toBe(1);
        expect(queued[1].featureId).toBe(second.featureId);
        expect(queued[1].queuePosition).toBe(2);
      });

      it('should handle recalculation with no remaining queued sessions', async () => {
        const active = await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const queued = await manager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);

        // Complete active and start queued
        await manager.updateSession(active.projectId, active.featureId, {
          status: 'completed',
        });
        await manager.startQueuedSession(projectId, queued.featureId);

        // Recalculate with no remaining queued sessions - should not throw
        await expect(
          manager.recalculateQueuePositions(projectId)
        ).resolves.not.toThrow();

        // No queued sessions remain
        const remaining = await manager.getQueuedSessions(projectId);
        expect(remaining).toHaveLength(0);
      });
    });

    describe('reorderQueuedSessions', () => {
      it('should reorder queued sessions according to provided order', async () => {
        // Create active session
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Create queued sessions
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

        const fourth = await manager.createSession({
          title: 'Fourth Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Initial positions: second=1, third=2, fourth=3
        expect(second.queuePosition).toBe(1);
        expect(third.queuePosition).toBe(2);
        expect(fourth.queuePosition).toBe(3);

        const projectId = manager.getProjectId(projectPath);

        // Reorder: fourth, second, third
        const reordered = await manager.reorderQueuedSessions(projectId, [
          fourth.featureId,
          second.featureId,
          third.featureId,
        ]);

        expect(reordered).toHaveLength(3);
        expect(reordered[0].featureId).toBe(fourth.featureId);
        expect(reordered[0].queuePosition).toBe(1);
        expect(reordered[1].featureId).toBe(second.featureId);
        expect(reordered[1].queuePosition).toBe(2);
        expect(reordered[2].featureId).toBe(third.featureId);
        expect(reordered[2].queuePosition).toBe(3);
      });

      it('should deduplicate feature IDs while preserving order', async () => {
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

        // Provide duplicates: third, second, third (duplicate)
        const reordered = await manager.reorderQueuedSessions(projectId, [
          third.featureId,
          second.featureId,
          third.featureId, // duplicate - should be ignored
        ]);

        expect(reordered).toHaveLength(2);
        expect(reordered[0].featureId).toBe(third.featureId);
        expect(reordered[0].queuePosition).toBe(1);
        expect(reordered[1].featureId).toBe(second.featureId);
        expect(reordered[1].queuePosition).toBe(2);
      });

      it('should throw error for non-queued session IDs', async () => {
        const active = await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);

        // Try to reorder with active session ID (not queued)
        await expect(
          manager.reorderQueuedSessions(projectId, [active.featureId])
        ).rejects.toThrow(/not queued sessions/i);
      });

      it('should throw error for non-existent feature IDs', async () => {
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        await manager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);

        await expect(
          manager.reorderQueuedSessions(projectId, ['non-existent-feature'])
        ).rejects.toThrow(/not queued sessions/i);
      });

      it('should handle partial reordering (only subset of queued sessions)', async () => {
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

        const fourth = await manager.createSession({
          title: 'Fourth Feature',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);

        // Only reorder third to front, others should follow in original order
        const reordered = await manager.reorderQueuedSessions(projectId, [third.featureId]);

        expect(reordered).toHaveLength(3);
        expect(reordered[0].featureId).toBe(third.featureId);
        expect(reordered[0].queuePosition).toBe(1);
        expect(reordered[1].featureId).toBe(second.featureId);
        expect(reordered[1].queuePosition).toBe(2);
        expect(reordered[2].featureId).toBe(fourth.featureId);
        expect(reordered[2].queuePosition).toBe(3);
      });

      it('should return empty array when no queued sessions', async () => {
        const session = await manager.createSession({
          title: 'Only Session',
          featureDescription: 'Test',
          projectPath,
        });

        const projectId = manager.getProjectId(projectPath);

        const reordered = await manager.reorderQueuedSessions(projectId, []);

        expect(reordered).toEqual([]);
      });

      it('should handle empty orderedFeatureIds array with existing queued sessions', async () => {
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

        // Empty array - should preserve existing order
        const reordered = await manager.reorderQueuedSessions(projectId, []);

        expect(reordered).toHaveLength(2);
        expect(reordered[0].featureId).toBe(second.featureId);
        expect(reordered[0].queuePosition).toBe(1);
        expect(reordered[1].featureId).toBe(third.featureId);
        expect(reordered[1].queuePosition).toBe(2);
      });

      it('should persist reordering to disk', async () => {
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

        // Reorder
        await manager.reorderQueuedSessions(projectId, [third.featureId, second.featureId]);

        // Read directly from disk to verify persistence
        const refreshedSecond = await manager.getSession(projectId, second.featureId);
        const refreshedThird = await manager.getSession(projectId, third.featureId);

        expect(refreshedThird!.queuePosition).toBe(1);
        expect(refreshedSecond!.queuePosition).toBe(2);
      });
    });

    describe('end-to-end queue prioritization workflow', () => {
      it('should correctly process sessions in priority order through full lifecycle', async () => {
        const projectId = manager.getProjectId(projectPath);

        // Create initial active session
        const first = await manager.createSession({
          title: 'First Feature',
          featureDescription: 'Test',
          projectPath,
        });
        expect(first.status).toBe('discovery');
        expect(first.queuePosition).toBeNull();

        // Queue more sessions
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

        // Insert a high priority session at front
        const urgent = await manager.createSession({
          title: 'Urgent Feature',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 'front',
        });

        // Verify initial queue state
        let queued = await manager.getQueuedSessions(projectId);
        expect(queued).toHaveLength(3);
        expect(queued[0].title).toBe('Urgent Feature');
        expect(queued[1].title).toBe('Second Feature');
        expect(queued[2].title).toBe('Third Feature');

        // Reorder: move third to front
        await manager.reorderQueuedSessions(projectId, [
          third.featureId,
          urgent.featureId,
          second.featureId,
        ]);

        // Verify reorder
        queued = await manager.getQueuedSessions(projectId);
        expect(queued[0].title).toBe('Third Feature');
        expect(queued[1].title).toBe('Urgent Feature');
        expect(queued[2].title).toBe('Second Feature');

        // Next session should be Third
        let next = await manager.getNextQueuedSession(projectId);
        expect(next!.title).toBe('Third Feature');

        // Complete first session and start next (Third)
        await manager.updateSession(projectId, first.featureId, {
          status: 'completed',
        });
        await manager.startQueuedSession(projectId, third.featureId);
        await manager.recalculateQueuePositions(projectId);

        // Verify Third is now active
        const activeThird = await manager.getSession(projectId, third.featureId);
        expect(activeThird!.status).toBe('discovery');
        expect(activeThird!.queuePosition).toBeNull();

        // Verify remaining queue: Urgent=1, Second=2
        queued = await manager.getQueuedSessions(projectId);
        expect(queued).toHaveLength(2);
        expect(queued[0].title).toBe('Urgent Feature');
        expect(queued[0].queuePosition).toBe(1);
        expect(queued[1].title).toBe('Second Feature');
        expect(queued[1].queuePosition).toBe(2);

        // Next should now be Urgent
        next = await manager.getNextQueuedSession(projectId);
        expect(next!.title).toBe('Urgent Feature');
      });

      it('should handle multiple insertAtPosition operations correctly', async () => {
        const projectId = manager.getProjectId(projectPath);

        // Create active session
        await manager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath,
        });

        // Create queue with various insertion points
        await manager.createSession({
          title: 'First Queued',
          featureDescription: 'Test',
          projectPath,
        }); // Position 1

        await manager.createSession({
          title: 'Second Queued',
          featureDescription: 'Test',
          projectPath,
        }); // Position 2

        // Insert at front
        await manager.createSession({
          title: 'Front Insert',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 'front',
        }); // Should be position 1

        // Insert at position 2
        await manager.createSession({
          title: 'Middle Insert',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 2,
        }); // Should be position 2

        // Insert at end
        await manager.createSession({
          title: 'End Insert',
          featureDescription: 'Test',
          projectPath,
          insertAtPosition: 'end',
        }); // Should be position 6

        const queued = await manager.getQueuedSessions(projectId);
        expect(queued).toHaveLength(5);
        expect(queued[0].title).toBe('Front Insert');
        expect(queued[0].queuePosition).toBe(1);
        expect(queued[1].title).toBe('Middle Insert');
        expect(queued[1].queuePosition).toBe(2);
        expect(queued[2].title).toBe('First Queued');
        expect(queued[2].queuePosition).toBe(3);
        expect(queued[3].title).toBe('Second Queued');
        expect(queued[3].queuePosition).toBe(4);
        expect(queued[4].title).toBe('End Insert');
        expect(queued[4].queuePosition).toBe(5);
      });
    });

    describe('backoutSession', () => {
      describe('pause action', () => {
        it('should pause an active session', async () => {
          const session = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'pause'
          );

          expect(result.session.status).toBe('paused');
          expect(result.session.backoutReason).toBe('user_requested');
          expect(result.session.backoutTimestamp).toBeDefined();
        });

        it('should pause an active session with specific reason', async () => {
          const session = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'pause',
            'blocked'
          );

          expect(result.session.status).toBe('paused');
          expect(result.session.backoutReason).toBe('blocked');
        });

        it('should pause a queued session', async () => {
          // Create active session first
          await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Create queued session
          const queued = await manager.createSession({
            title: 'Queued Feature',
            featureDescription: 'Test',
            projectPath,
          });

          expect(queued.status).toBe('queued');

          const result = await manager.backoutSession(
            queued.projectId,
            queued.featureId,
            'pause',
            'deprioritized'
          );

          expect(result.session.status).toBe('paused');
          expect(result.session.backoutReason).toBe('deprioritized');
          expect(result.session.queuePosition).toBeNull();
        });
      });

      describe('abandon action', () => {
        it('should abandon an active session with failed status', async () => {
          const session = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'abandon'
          );

          expect(result.session.status).toBe('failed');
          expect(result.session.backoutReason).toBe('user_requested');
          expect(result.session.backoutTimestamp).toBeDefined();
        });

        it('should abandon an active session with specific reason', async () => {
          const session = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'abandon',
            'blocked'
          );

          expect(result.session.status).toBe('failed');
          expect(result.session.backoutReason).toBe('blocked');
        });
      });

      describe('status validation', () => {
        it('should throw when trying to back out from completed session', async () => {
          const session = await manager.createSession({
            title: 'Completed Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Mark as completed
          await manager.updateSession(session.projectId, session.featureId, {
            status: 'completed',
          });

          await expect(
            manager.backoutSession(session.projectId, session.featureId, 'pause')
          ).rejects.toThrow(/cannot back out.*completed/i);
        });

        it('should throw when trying to back out from already paused session', async () => {
          const session = await manager.createSession({
            title: 'Paused Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // First pause
          await manager.backoutSession(session.projectId, session.featureId, 'pause');

          // Try to pause again
          await expect(
            manager.backoutSession(session.projectId, session.featureId, 'pause')
          ).rejects.toThrow(/cannot back out.*paused/i);
        });

        it('should throw when trying to back out from failed session', async () => {
          const session = await manager.createSession({
            title: 'Failed Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Mark as failed
          await manager.updateSession(session.projectId, session.featureId, {
            status: 'failed',
          });

          await expect(
            manager.backoutSession(session.projectId, session.featureId, 'pause')
          ).rejects.toThrow(/cannot back out.*failed/i);
        });

        it('should throw for non-existent session', async () => {
          await expect(
            manager.backoutSession('nonexistent', 'session', 'pause')
          ).rejects.toThrow(/session not found/i);
        });
      });

      describe('queue promotion', () => {
        it('should promote next queued session when active session is backed out', async () => {
          // Create active session
          const active = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Create queued sessions
          const queued1 = await manager.createSession({
            title: 'Queued One',
            featureDescription: 'Test',
            projectPath,
          });

          const queued2 = await manager.createSession({
            title: 'Queued Two',
            featureDescription: 'Test',
            projectPath,
          });

          expect(queued1.status).toBe('queued');
          expect(queued2.status).toBe('queued');

          // Back out active session
          const result = await manager.backoutSession(
            active.projectId,
            active.featureId,
            'pause'
          );

          // First queued session should be promoted
          expect(result.promotedSession).not.toBeNull();
          expect(result.promotedSession!.featureId).toBe(queued1.featureId);
          expect(result.promotedSession!.status).toBe('discovery');

          // Verify second queued session's position is recalculated
          const updatedQueued2 = await manager.getSession(
            queued2.projectId,
            queued2.featureId
          );
          expect(updatedQueued2!.queuePosition).toBe(1);
        });

        it('should not promote if there is still another active session', async () => {
          // Create two active-eligible sessions for different projects
          // This test just validates no promotion happens for queued sessions
          const active = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          const queued = await manager.createSession({
            title: 'Queued Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Back out the queued session (not the active one)
          const result = await manager.backoutSession(
            queued.projectId,
            queued.featureId,
            'pause'
          );

          // No promotion because the active session still exists
          expect(result.promotedSession).toBeNull();

          // Active session should still be active
          const stillActive = await manager.getSession(active.projectId, active.featureId);
          expect(stillActive!.status).toBe('discovery');
        });

        it('should return null promotedSession when no queued sessions exist', async () => {
          const session = await manager.createSession({
            title: 'Only Session',
            featureDescription: 'Test',
            projectPath,
          });

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'pause'
          );

          expect(result.promotedSession).toBeNull();
        });
      });

      describe('status.json updates', () => {
        it('should update status.json with paused status on pause', async () => {
          const session = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.backoutSession(
            session.projectId,
            session.featureId,
            'pause'
          );

          // Read status.json directly
          const statusPath = path.join(
            testDir,
            session.projectId,
            session.featureId,
            'status.json'
          );
          const statusFile = await fs.readJson(statusPath);

          expect(statusFile.status).toBe('paused');
          expect(statusFile.lastAction).toBe('session_paused');
        });

        it('should update status.json with error status on abandon', async () => {
          const session = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.backoutSession(
            session.projectId,
            session.featureId,
            'abandon'
          );

          // Read status.json directly
          const statusPath = path.join(
            testDir,
            session.projectId,
            session.featureId,
            'status.json'
          );
          const statusFile = await fs.readJson(statusPath);

          expect(statusFile.status).toBe('error');
          expect(statusFile.lastAction).toBe('session_abandoned');
        });
      });

      describe('backout from different stages', () => {
        it('should allow backout from discovery (stage 1)', async () => {
          const session = await manager.createSession({
            title: 'Stage 1 Feature',
            featureDescription: 'Test',
            projectPath,
          });

          expect(session.status).toBe('discovery');
          expect(session.currentStage).toBe(1);

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'pause'
          );

          expect(result.session.status).toBe('paused');
        });

        it('should allow backout from planning (stage 2)', async () => {
          const session = await manager.createSession({
            title: 'Stage 2 Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.transitionStage(session.projectId, session.featureId, 2);

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'pause'
          );

          expect(result.session.status).toBe('paused');
        });

        it('should allow backout from implementing (stage 3)', async () => {
          const session = await manager.createSession({
            title: 'Stage 3 Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.transitionStage(session.projectId, session.featureId, 2);
          await manager.transitionStage(session.projectId, session.featureId, 3);

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'pause'
          );

          expect(result.session.status).toBe('paused');
        });

        it('should allow backout from final_approval (stage 6)', async () => {
          const session = await manager.createSession({
            title: 'Stage 6 Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Progress to stage 6
          await manager.transitionStage(session.projectId, session.featureId, 2);
          await manager.transitionStage(session.projectId, session.featureId, 3);
          await manager.transitionStage(session.projectId, session.featureId, 4);
          await manager.transitionStage(session.projectId, session.featureId, 5);
          await manager.transitionStage(session.projectId, session.featureId, 6);

          const result = await manager.backoutSession(
            session.projectId,
            session.featureId,
            'pause'
          );

          expect(result.session.status).toBe('paused');
        });
      });

      describe('all backout reasons', () => {
        const reasons: BackoutReason[] = ['user_requested', 'blocked', 'deprioritized'];

        for (const reason of reasons) {
          it(`should accept '${reason}' as backout reason`, async () => {
            const session = await manager.createSession({
              title: `Test ${reason}`,
              featureDescription: 'Test',
              projectPath,
            });

            const result = await manager.backoutSession(
              session.projectId,
              session.featureId,
              'pause',
              reason
            );

            expect(result.session.backoutReason).toBe(reason);
          });
        }
      });

      describe('queue recalculation', () => {
        it('should recalculate queue positions when queued session is backed out', async () => {
          // Create active session
          await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Create queued sessions
          const queued1 = await manager.createSession({
            title: 'Queued One',
            featureDescription: 'Test',
            projectPath,
          });

          const queued2 = await manager.createSession({
            title: 'Queued Two',
            featureDescription: 'Test',
            projectPath,
          });

          const queued3 = await manager.createSession({
            title: 'Queued Three',
            featureDescription: 'Test',
            projectPath,
          });

          expect(queued1.queuePosition).toBe(1);
          expect(queued2.queuePosition).toBe(2);
          expect(queued3.queuePosition).toBe(3);

          // Back out queued2
          await manager.backoutSession(
            queued2.projectId,
            queued2.featureId,
            'pause'
          );

          // Verify queue positions are recalculated
          const updatedQueued1 = await manager.getSession(
            queued1.projectId,
            queued1.featureId
          );
          const updatedQueued3 = await manager.getSession(
            queued3.projectId,
            queued3.featureId
          );

          expect(updatedQueued1!.queuePosition).toBe(1);
          expect(updatedQueued3!.queuePosition).toBe(2);
        });
      });
    });

    describe('resumeSession', () => {
      describe('basic resume functionality', () => {
        it('should resume a paused session to its previous stage', async () => {
          const session = await manager.createSession({
            title: 'Paused Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Progress to stage 2
          await manager.transitionStage(session.projectId, session.featureId, 2);

          // Pause the session
          await manager.backoutSession(session.projectId, session.featureId, 'pause');

          // Verify it's paused
          const paused = await manager.getSession(session.projectId, session.featureId);
          expect(paused!.status).toBe('paused');
          expect(paused!.currentStage).toBe(2);

          // Resume the session
          const result = await manager.resumeSession(session.projectId, session.featureId);

          expect(result.session.status).toBe('planning');
          expect(result.session.currentStage).toBe(2);
          expect(result.session.backoutReason).toBeNull();
          expect(result.session.backoutTimestamp).toBeNull();
          expect(result.wasQueued).toBe(false);
        });

        it('should resume a paused session from stage 1', async () => {
          const session = await manager.createSession({
            title: 'Stage 1 Paused',
            featureDescription: 'Test',
            projectPath,
          });

          // Pause at stage 1
          await manager.backoutSession(session.projectId, session.featureId, 'pause');

          // Resume
          const result = await manager.resumeSession(session.projectId, session.featureId);

          expect(result.session.status).toBe('discovery');
          expect(result.session.currentStage).toBe(1);
          expect(result.wasQueued).toBe(false);
        });

        it('should resume a paused session from stage 3', async () => {
          const session = await manager.createSession({
            title: 'Stage 3 Paused',
            featureDescription: 'Test',
            projectPath,
          });

          // Progress to stage 3
          await manager.transitionStage(session.projectId, session.featureId, 2);
          await manager.transitionStage(session.projectId, session.featureId, 3);

          // Pause
          await manager.backoutSession(session.projectId, session.featureId, 'pause');

          // Resume
          const result = await manager.resumeSession(session.projectId, session.featureId);

          expect(result.session.status).toBe('implementing');
          expect(result.session.currentStage).toBe(3);
        });

        it('should clear backout metadata on resume', async () => {
          const session = await manager.createSession({
            title: 'Metadata Test',
            featureDescription: 'Test',
            projectPath,
          });

          // Pause with reason
          await manager.backoutSession(session.projectId, session.featureId, 'pause', 'blocked');

          // Verify metadata is set
          const paused = await manager.getSession(session.projectId, session.featureId);
          expect(paused!.backoutReason).toBe('blocked');
          expect(paused!.backoutTimestamp).toBeDefined();

          // Resume
          const result = await manager.resumeSession(session.projectId, session.featureId);

          expect(result.session.backoutReason).toBeNull();
          expect(result.session.backoutTimestamp).toBeNull();
        });
      });

      describe('status validation', () => {
        it('should throw when trying to resume a non-paused session', async () => {
          const session = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await expect(
            manager.resumeSession(session.projectId, session.featureId)
          ).rejects.toThrow(/cannot resume.*discovery/i);
        });

        it('should throw when trying to resume a completed session', async () => {
          const session = await manager.createSession({
            title: 'Completed Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.updateSession(session.projectId, session.featureId, {
            status: 'completed',
          });

          await expect(
            manager.resumeSession(session.projectId, session.featureId)
          ).rejects.toThrow(/cannot resume.*completed/i);
        });

        it('should throw when trying to resume a failed session', async () => {
          const session = await manager.createSession({
            title: 'Failed Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.updateSession(session.projectId, session.featureId, {
            status: 'failed',
          });

          await expect(
            manager.resumeSession(session.projectId, session.featureId)
          ).rejects.toThrow(/cannot resume.*failed/i);
        });

        it('should throw for non-existent session', async () => {
          await expect(
            manager.resumeSession('nonexistent', 'session')
          ).rejects.toThrow(/session not found/i);
        });
      });

      describe('queue handling', () => {
        it('should queue resumed session when another session is active', async () => {
          // Create and keep an active session
          const active = await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Create and pause another session
          const paused = await manager.createSession({
            title: 'Paused Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Pause it
          await manager.backoutSession(paused.projectId, paused.featureId, 'pause');

          // Resume it - should be queued since active exists
          const result = await manager.resumeSession(paused.projectId, paused.featureId);

          expect(result.wasQueued).toBe(true);
          expect(result.session.status).toBe('queued');
          expect(result.session.currentStage).toBe(0);
          expect(result.session.queuePosition).toBe(1);
          expect(result.session.queuedAt).toBeDefined();
        });

        it('should insert resumed session at front of queue', async () => {
          // Create active session
          await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Create queued session
          const queued = await manager.createSession({
            title: 'Queued Feature',
            featureDescription: 'Test',
            projectPath,
          });

          expect(queued.queuePosition).toBe(1);

          // Create and pause another session
          const paused = await manager.createSession({
            title: 'Paused Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.backoutSession(paused.projectId, paused.featureId, 'pause');

          // Resume it - should be at front of queue
          const result = await manager.resumeSession(paused.projectId, paused.featureId);

          expect(result.session.queuePosition).toBe(1);

          // Original queued session should be shifted to position 2
          const updatedQueued = await manager.getSession(queued.projectId, queued.featureId);
          expect(updatedQueued!.queuePosition).toBe(2);
        });

        it('should shift multiple queued sessions when resuming', async () => {
          // Create active session
          await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Create multiple queued sessions
          const queued1 = await manager.createSession({
            title: 'Queued One',
            featureDescription: 'Test',
            projectPath,
          });

          const queued2 = await manager.createSession({
            title: 'Queued Two',
            featureDescription: 'Test',
            projectPath,
          });

          // Create and pause a session
          const paused = await manager.createSession({
            title: 'Paused Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.backoutSession(paused.projectId, paused.featureId, 'pause');

          // Resume - should be at front
          await manager.resumeSession(paused.projectId, paused.featureId);

          // Verify positions
          const projectId = manager.getProjectId(projectPath);
          const allQueued = await manager.getQueuedSessions(projectId);

          expect(allQueued).toHaveLength(3);
          expect(allQueued[0].title).toBe('Paused Feature');
          expect(allQueued[0].queuePosition).toBe(1);
          expect(allQueued[1].title).toBe('Queued One');
          expect(allQueued[1].queuePosition).toBe(2);
          expect(allQueued[2].title).toBe('Queued Two');
          expect(allQueued[2].queuePosition).toBe(3);
        });

        it('should start immediately when no active session exists', async () => {
          const session = await manager.createSession({
            title: 'Only Session',
            featureDescription: 'Test',
            projectPath,
          });

          // Progress to stage 2
          await manager.transitionStage(session.projectId, session.featureId, 2);

          // Pause
          await manager.backoutSession(session.projectId, session.featureId, 'pause');

          // Resume - should start immediately
          const result = await manager.resumeSession(session.projectId, session.featureId);

          expect(result.wasQueued).toBe(false);
          expect(result.session.status).toBe('planning');
          expect(result.session.queuePosition).toBeNull();
          expect(result.session.queuedAt).toBeNull();
        });
      });

      describe('status.json updates', () => {
        it('should update status.json when resuming immediately', async () => {
          const session = await manager.createSession({
            title: 'Status Test',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.backoutSession(session.projectId, session.featureId, 'pause');
          await manager.resumeSession(session.projectId, session.featureId);

          // Read status.json directly
          const statusPath = path.join(
            testDir,
            session.projectId,
            session.featureId,
            'status.json'
          );
          const statusFile = await fs.readJson(statusPath);

          expect(statusFile.status).toBe('idle');
          expect(statusFile.lastAction).toBe('session_resumed');
          expect(statusFile.currentStage).toBe(1);
        });

        it('should update status.json when resuming to queue', async () => {
          // Create active session
          await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Create and pause another session
          const paused = await manager.createSession({
            title: 'Paused Feature',
            featureDescription: 'Test',
            projectPath,
          });

          await manager.backoutSession(paused.projectId, paused.featureId, 'pause');
          await manager.resumeSession(paused.projectId, paused.featureId);

          // Read status.json directly
          const statusPath = path.join(
            testDir,
            paused.projectId,
            paused.featureId,
            'status.json'
          );
          const statusFile = await fs.readJson(statusPath);

          expect(statusFile.status).toBe('queued');
          expect(statusFile.lastAction).toBe('session_queued');
          expect(statusFile.currentStage).toBe(0);
        });
      });

      describe('resuming previously queued sessions', () => {
        it('should handle resuming a session that was queued when paused', async () => {
          // Create active session
          await manager.createSession({
            title: 'Active Feature',
            featureDescription: 'Test',
            projectPath,
          });

          // Create a queued session
          const queued = await manager.createSession({
            title: 'Queued Feature',
            featureDescription: 'Test',
            projectPath,
          });

          expect(queued.status).toBe('queued');
          expect(queued.currentStage).toBe(0);

          // Pause the queued session
          await manager.backoutSession(queued.projectId, queued.featureId, 'pause');

          // Resume it
          const result = await manager.resumeSession(queued.projectId, queued.featureId);

          // Should be queued again since active session still exists
          expect(result.wasQueued).toBe(true);
          expect(result.session.status).toBe('queued');
          expect(result.session.queuePosition).toBe(1);
        });
      });

      describe('resume from different stages', () => {
        it('should resume from stage 4 (pr_creation)', async () => {
          const session = await manager.createSession({
            title: 'Stage 4 Session',
            featureDescription: 'Test',
            projectPath,
          });

          // Progress to stage 4
          await manager.transitionStage(session.projectId, session.featureId, 2);
          await manager.transitionStage(session.projectId, session.featureId, 3);
          await manager.transitionStage(session.projectId, session.featureId, 4);

          // Pause and resume
          await manager.backoutSession(session.projectId, session.featureId, 'pause');
          const result = await manager.resumeSession(session.projectId, session.featureId);

          expect(result.session.status).toBe('pr_creation');
          expect(result.session.currentStage).toBe(4);
        });

        it('should resume from stage 5 (pr_review)', async () => {
          const session = await manager.createSession({
            title: 'Stage 5 Session',
            featureDescription: 'Test',
            projectPath,
          });

          // Progress to stage 5
          await manager.transitionStage(session.projectId, session.featureId, 2);
          await manager.transitionStage(session.projectId, session.featureId, 3);
          await manager.transitionStage(session.projectId, session.featureId, 4);
          await manager.transitionStage(session.projectId, session.featureId, 5);

          // Pause and resume
          await manager.backoutSession(session.projectId, session.featureId, 'pause');
          const result = await manager.resumeSession(session.projectId, session.featureId);

          expect(result.session.status).toBe('pr_review');
          expect(result.session.currentStage).toBe(5);
        });

        it('should resume from stage 6 (final_approval)', async () => {
          const session = await manager.createSession({
            title: 'Stage 6 Session',
            featureDescription: 'Test',
            projectPath,
          });

          // Progress to stage 6
          await manager.transitionStage(session.projectId, session.featureId, 2);
          await manager.transitionStage(session.projectId, session.featureId, 3);
          await manager.transitionStage(session.projectId, session.featureId, 4);
          await manager.transitionStage(session.projectId, session.featureId, 5);
          await manager.transitionStage(session.projectId, session.featureId, 6);

          // Pause and resume
          await manager.backoutSession(session.projectId, session.featureId, 'pause');
          const result = await manager.resumeSession(session.projectId, session.featureId);

          expect(result.session.status).toBe('final_approval');
          expect(result.session.currentStage).toBe(6);
        });
      });
    });
  });
});
