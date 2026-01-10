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
  });
});
