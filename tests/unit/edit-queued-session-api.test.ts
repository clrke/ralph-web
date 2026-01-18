import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { SessionManager } from '../../server/src/services/SessionManager';
import { createApp } from '../../server/src/app';

describe('Edit Queued Session API Endpoint', () => {
  let app: Express;
  let testDir: string;
  let storage: FileStorageService;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `test-edit-api-${Date.now()}`);
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

  describe('PATCH /api/sessions/:projectId/:featureId/edit', () => {
    describe('successful edits', () => {
      it('should edit a queued session successfully', async () => {
        // Create active session first
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original description',
          projectPath: '/test/project',
        });

        expect(session.status).toBe('queued');

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Updated Title',
            featureDescription: 'Updated description',
          });

        expect(response.status).toBe(200);
        expect(response.body.title).toBe('Updated Title');
        expect(response.body.featureDescription).toBe('Updated description');
        expect(response.body.dataVersion).toBe(2);
      });

      it('should return updated session with incremented dataVersion', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'New Title',
          });

        expect(response.status).toBe(200);
        expect(response.body.dataVersion).toBe(2);
        expect(response.body.title).toBe('New Title');
        // Other fields should be preserved
        expect(response.body.featureDescription).toBe('Original');
      });

      it('should allow editing all content fields', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const updates = {
          dataVersion: 1,
          title: 'New Title',
          featureDescription: 'New description',
          acceptanceCriteria: [{ text: 'AC 1', checked: false, type: 'manual' }],
          affectedFiles: ['src/app.ts'],
          technicalNotes: 'New notes',
          baseBranch: 'develop',
          preferences: {
            riskComfort: 'high',
            speedVsQuality: 'quality',
            scopeFlexibility: 'open',
            detailLevel: 'detailed',
            autonomyLevel: 'autonomous',
          },
        };

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send(updates);

        expect(response.status).toBe(200);
        expect(response.body.title).toBe('New Title');
        expect(response.body.featureDescription).toBe('New description');
        expect(response.body.acceptanceCriteria).toHaveLength(1);
        expect(response.body.affectedFiles).toEqual(['src/app.ts']);
        expect(response.body.technicalNotes).toBe('New notes');
        expect(response.body.baseBranch).toBe('develop');
        expect(response.body.preferences.riskComfort).toBe('high');
      });

      it('should persist changes to storage', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Persisted Title',
          });

        // Fetch session via GET to verify persistence
        const getResponse = await request(app)
          .get(`/api/sessions/${session.projectId}/${session.featureId}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.title).toBe('Persisted Title');
        expect(getResponse.body.dataVersion).toBe(2);
      });
    });

    describe('404 Not Found errors', () => {
      it('should return 404 for non-existent session', async () => {
        const response = await request(app)
          .patch('/api/sessions/nonexistent/feature/edit')
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(404);
        expect(response.body.error).toContain('not found');
      });

      it('should return 404 for valid project but non-existent feature', async () => {
        // Create a session to get a valid projectId
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/nonexistent-feature/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(404);
        expect(response.body.error).toContain('not found');
      });
    });

    describe('400 Bad Request errors (SESSION_NOT_QUEUED)', () => {
      it('should return 400 when trying to edit a discovery session', async () => {
        const session = await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        expect(session.status).toBe('discovery');

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('SESSION_NOT_QUEUED');
        expect(response.body.error).toContain("Cannot edit session with status 'discovery'");
      });

      it('should return 400 when trying to edit a paused session', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // Pause the session
        await sessionManager.backoutSession(session.projectId, session.featureId, 'pause');

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('SESSION_NOT_QUEUED');
        expect(response.body.error).toContain("Cannot edit session with status 'paused'");
      });

      it('should return 400 when trying to edit a failed session', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // Abandon the session (sets status to failed)
        await sessionManager.backoutSession(session.projectId, session.featureId, 'abandon');

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('SESSION_NOT_QUEUED');
        expect(response.body.error).toContain("Cannot edit session with status 'failed'");
      });

      it('should return 400 when trying to edit a completed session', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // Transition to completed
        await sessionManager.transitionStage(session.projectId, session.featureId, 2);
        await sessionManager.transitionStage(session.projectId, session.featureId, 3);
        await sessionManager.transitionStage(session.projectId, session.featureId, 4);
        await sessionManager.transitionStage(session.projectId, session.featureId, 5);
        await sessionManager.transitionStage(session.projectId, session.featureId, 6);
        await sessionManager.transitionStage(session.projectId, session.featureId, 7);

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('SESSION_NOT_QUEUED');
      });
    });

    describe('409 Conflict errors (VERSION_CONFLICT)', () => {
      it('should return 409 when dataVersion does not match', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        expect(session.dataVersion).toBe(1);

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 999, // Wrong version
            title: 'Test',
          });

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('VERSION_CONFLICT');
        expect(response.body.error).toContain('expected dataVersion 999');
        expect(response.body.error).toContain('has dataVersion 1');
      });

      it('should return 409 on concurrent edit conflict', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        // First edit succeeds
        const response1 = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'First Edit',
          });

        expect(response1.status).toBe(200);
        expect(response1.body.dataVersion).toBe(2);

        // Second edit with stale version fails
        const response2 = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1, // Stale version
            title: 'Second Edit',
          });

        expect(response2.status).toBe(409);
        expect(response2.body.code).toBe('VERSION_CONFLICT');
      });

      it('should succeed with correct version after previous edit', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        // First edit
        const response1 = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'First Edit',
          });

        expect(response1.status).toBe(200);

        // Second edit with updated version
        const response2 = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: response1.body.dataVersion, // Use new version
            title: 'Second Edit',
          });

        expect(response2.status).toBe(200);
        expect(response2.body.title).toBe('Second Edit');
        expect(response2.body.dataVersion).toBe(3);
      });
    });

    describe('validation errors', () => {
      it('should return 400 for missing dataVersion', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            title: 'Test', // Missing dataVersion
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 for invalid dataVersion (zero)', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 0,
            title: 'Test',
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 for empty title', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: '',
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 for unknown fields (strict mode)', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
            status: 'discovery', // Not allowed
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 for absolute paths in affectedFiles', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            affectedFiles: ['/absolute/path/file.ts'],
          });

        expect(response.status).toBe(400);
      });
    });

    describe('field preservation', () => {
      it('should not change protected fields on edit', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const originalId = session.id;
        const originalProjectId = session.projectId;
        const originalFeatureId = session.featureId;
        const originalCreatedAt = session.createdAt;
        const originalStatus = session.status;
        const originalQueuePosition = session.queuePosition;

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Updated Title',
          });

        expect(response.status).toBe(200);
        expect(response.body.id).toBe(originalId);
        expect(response.body.projectId).toBe(originalProjectId);
        expect(response.body.featureId).toBe(originalFeatureId);
        expect(response.body.createdAt).toBe(originalCreatedAt);
        expect(response.body.status).toBe(originalStatus);
        expect(response.body.queuePosition).toBe(originalQueuePosition);
      });

      it('should not change featureId when title changes', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Active',
          projectPath: '/test/project',
        });

        // Create queued session
        const session = await sessionManager.createSession({
          title: 'Original Title',
          featureDescription: 'Original',
          projectPath: '/test/project',
        });

        const originalFeatureId = session.featureId;

        const response = await request(app)
          .patch(`/api/sessions/${session.projectId}/${session.featureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Completely Different Title',
          });

        expect(response.status).toBe(200);
        expect(response.body.featureId).toBe(originalFeatureId);
        expect(response.body.title).toBe('Completely Different Title');
      });
    });
  });
});
