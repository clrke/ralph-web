import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { SessionManager } from '../../server/src/services/SessionManager';
import { createApp } from '../../server/src/app';
import { DEFAULT_USER_PREFERENCES, UserPreferences } from '../../shared/types';

describe('Project Preferences API', () => {
  let app: Express;
  let testDir: string;
  let storage: FileStorageService;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `test-prefs-api-${Date.now()}`);
    await fs.ensureDir(testDir);
    storage = new FileStorageService(testDir);
    sessionManager = new SessionManager(storage);
    const result = createApp(storage, sessionManager);
    app = result.app;
  });

  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      await fs.remove(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('GET /api/projects/:projectId/preferences', () => {
    it('should return default preferences when no preferences are saved', async () => {
      const response = await request(app).get('/api/projects/test-project/preferences');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(DEFAULT_USER_PREFERENCES);
    });

    it('should return saved preferences when they exist', async () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      // Save preferences directly to storage
      await storage.writeJson('test-project/preferences.json', customPrefs);

      const response = await request(app).get('/api/projects/test-project/preferences');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(customPrefs);
    });

    it('should handle URL-encoded project IDs', async () => {
      const response = await request(app).get('/api/projects/test%2Fproject/preferences');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(DEFAULT_USER_PREFERENCES);
    });
  });

  describe('PUT /api/projects/:projectId/preferences', () => {
    it('should save valid preferences', async () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(customPrefs);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(customPrefs);

      // Verify preferences were saved
      const saved = await storage.readJson<UserPreferences>('test-project/preferences.json');
      expect(saved).toEqual(customPrefs);
    });

    it('should reject invalid riskComfort value', async () => {
      const invalidPrefs = {
        riskComfort: 'extreme', // invalid
        speedVsQuality: 'balanced',
        scopeFlexibility: 'flexible',
        detailLevel: 'standard',
        autonomyLevel: 'collaborative',
      };

      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(invalidPrefs);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid preferences');
    });

    it('should reject invalid speedVsQuality value', async () => {
      const invalidPrefs = {
        riskComfort: 'medium',
        speedVsQuality: 'fast', // invalid
        scopeFlexibility: 'flexible',
        detailLevel: 'standard',
        autonomyLevel: 'collaborative',
      };

      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(invalidPrefs);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid preferences');
    });

    it('should reject invalid scopeFlexibility value', async () => {
      const invalidPrefs = {
        riskComfort: 'medium',
        speedVsQuality: 'balanced',
        scopeFlexibility: 'strict', // invalid
        detailLevel: 'standard',
        autonomyLevel: 'collaborative',
      };

      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(invalidPrefs);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid preferences');
    });

    it('should reject invalid detailLevel value', async () => {
      const invalidPrefs = {
        riskComfort: 'medium',
        speedVsQuality: 'balanced',
        scopeFlexibility: 'flexible',
        detailLevel: 'verbose', // invalid
        autonomyLevel: 'collaborative',
      };

      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(invalidPrefs);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid preferences');
    });

    it('should reject invalid autonomyLevel value', async () => {
      const invalidPrefs = {
        riskComfort: 'medium',
        speedVsQuality: 'balanced',
        scopeFlexibility: 'flexible',
        detailLevel: 'standard',
        autonomyLevel: 'full', // invalid
      };

      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(invalidPrefs);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid preferences');
    });

    it('should reject preferences with missing fields', async () => {
      const incompletePrefs = {
        riskComfort: 'medium',
        speedVsQuality: 'balanced',
        // missing scopeFlexibility, detailLevel, autonomyLevel
      };

      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(incompletePrefs);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid preferences');
    });

    it('should reject empty body', async () => {
      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid preferences');
    });

    it('should overwrite existing preferences', async () => {
      const firstPrefs: UserPreferences = {
        riskComfort: 'low',
        speedVsQuality: 'speed',
        scopeFlexibility: 'fixed',
        detailLevel: 'minimal',
        autonomyLevel: 'guided',
      };

      const secondPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      // Save first preferences
      await request(app)
        .put('/api/projects/test-project/preferences')
        .send(firstPrefs);

      // Overwrite with second preferences
      const response = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(secondPrefs);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(secondPrefs);

      // Verify second preferences are saved
      const saved = await storage.readJson<UserPreferences>('test-project/preferences.json');
      expect(saved).toEqual(secondPrefs);
    });

    it('should accept all valid values for each field', async () => {
      // Test all valid combinations
      const allLowPrefs: UserPreferences = {
        riskComfort: 'low',
        speedVsQuality: 'speed',
        scopeFlexibility: 'fixed',
        detailLevel: 'minimal',
        autonomyLevel: 'guided',
      };

      const response1 = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(allLowPrefs);
      expect(response1.status).toBe(200);

      const allMidPrefs: UserPreferences = {
        riskComfort: 'medium',
        speedVsQuality: 'balanced',
        scopeFlexibility: 'flexible',
        detailLevel: 'standard',
        autonomyLevel: 'collaborative',
      };

      const response2 = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(allMidPrefs);
      expect(response2.status).toBe(200);

      const allHighPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      const response3 = await request(app)
        .put('/api/projects/test-project/preferences')
        .send(allHighPrefs);
      expect(response3.status).toBe(200);
    });
  });

  describe('Preferences roundtrip', () => {
    it('should save and retrieve preferences correctly', async () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      // Save preferences
      await request(app)
        .put('/api/projects/test-project/preferences')
        .send(customPrefs);

      // Retrieve preferences
      const response = await request(app).get('/api/projects/test-project/preferences');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(customPrefs);
    });
  });

  describe('Session creation with preferences', () => {
    it('should create session with default preferences when no project preferences exist', async () => {
      const response = await request(app)
        .post('/api/sessions')
        .send({
          title: 'Test Feature',
          featureDescription: 'A test feature',
          projectPath: '/test/project/path',
        });

      expect(response.status).toBe(201);
      expect(response.body.preferences).toEqual(DEFAULT_USER_PREFERENCES);
    });

    it('should create session with saved project preferences', async () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      // First, save project preferences
      const projectId = sessionManager.getProjectId('/test/project/with-prefs');
      await storage.writeJson(`${projectId}/preferences.json`, customPrefs);

      // Create session for that project
      const response = await request(app)
        .post('/api/sessions')
        .send({
          title: 'Feature With Prefs',
          featureDescription: 'A feature with custom preferences',
          projectPath: '/test/project/with-prefs',
        });

      expect(response.status).toBe(201);
      expect(response.body.preferences).toEqual(customPrefs);
    });

    it('should persist preferences in session.json file', async () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'low',
        speedVsQuality: 'speed',
        scopeFlexibility: 'fixed',
        detailLevel: 'minimal',
        autonomyLevel: 'guided',
      };

      // Save project preferences
      const projectId = sessionManager.getProjectId('/test/project/persist-test');
      await storage.writeJson(`${projectId}/preferences.json`, customPrefs);

      // Create session
      const response = await request(app)
        .post('/api/sessions')
        .send({
          title: 'Persist Test Feature',
          featureDescription: 'Testing persistence',
          projectPath: '/test/project/persist-test',
        });

      expect(response.status).toBe(201);

      // Verify preferences are persisted in session.json
      const featureId = response.body.featureId;
      const savedSession = await storage.readJson<{ preferences: UserPreferences }>(
        `${projectId}/${featureId}/session.json`
      );

      expect(savedSession?.preferences).toEqual(customPrefs);
    });

    it('should allow passing preferences in session creation request', async () => {
      const inputPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      const response = await request(app)
        .post('/api/sessions')
        .send({
          title: 'Feature With Input Prefs',
          featureDescription: 'Testing input preferences',
          projectPath: '/test/project/input-prefs',
          preferences: inputPrefs,
        });

      expect(response.status).toBe(201);
      expect(response.body.preferences).toEqual(inputPrefs);
    });

    it('should prioritize request preferences over project preferences', async () => {
      const projectPrefs: UserPreferences = {
        riskComfort: 'low',
        speedVsQuality: 'speed',
        scopeFlexibility: 'fixed',
        detailLevel: 'minimal',
        autonomyLevel: 'guided',
      };

      const inputPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      // First, save project preferences
      const projectId = sessionManager.getProjectId('/test/project/priority-test');
      await storage.writeJson(`${projectId}/preferences.json`, projectPrefs);

      // Create session with input preferences (should override project preferences)
      const response = await request(app)
        .post('/api/sessions')
        .send({
          title: 'Priority Test Feature',
          featureDescription: 'Testing preference priority',
          projectPath: '/test/project/priority-test',
          preferences: inputPrefs,
        });

      expect(response.status).toBe(201);
      expect(response.body.preferences).toEqual(inputPrefs);
    });

    it('should reject invalid preferences in session creation request', async () => {
      const response = await request(app)
        .post('/api/sessions')
        .send({
          title: 'Invalid Prefs Feature',
          featureDescription: 'Testing invalid preferences',
          projectPath: '/test/project/invalid-prefs',
          preferences: {
            riskComfort: 'extreme', // invalid
            speedVsQuality: 'balanced',
            scopeFlexibility: 'flexible',
            detailLevel: 'standard',
            autonomyLevel: 'collaborative',
          },
        });

      expect(response.status).toBe(400);
    });
  });
});
