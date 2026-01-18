import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { Server } from 'socket.io';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { SessionManager } from '../../server/src/services/SessionManager';
import { EventBroadcaster } from '../../server/src/services/EventBroadcaster';
import { createApp } from '../../server/src/app';

describe('Backout/Resume API Endpoints', () => {
  let app: Express;
  let testDir: string;
  let storage: FileStorageService;
  let sessionManager: SessionManager;
  let projectPath: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `test-backout-api-${Date.now()}`);
    await fs.ensureDir(testDir);
    storage = new FileStorageService(testDir);
    sessionManager = new SessionManager(storage);
    const result = createApp(storage, sessionManager);
    app = result.app;

    // Create a test project path
    projectPath = path.join(testDir, 'test-project');
    await fs.ensureDir(projectPath);
  });

  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      await fs.remove(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('POST /api/sessions/:projectId/:featureId/backout', () => {
    describe('pause action', () => {
      it('should pause an active session', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('paused');
        expect(response.body.session.backoutReason).toBe('user_requested');
        expect(response.body.session.backoutTimestamp).toBeDefined();
      });

      it('should pause with specific reason', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'pause', reason: 'blocked' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('paused');
        expect(response.body.session.backoutReason).toBe('blocked');
      });

      it('should pause a queued session', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // Create queued session
        const queued = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        expect(queued.status).toBe('queued');

        const response = await request(app)
          .post(`/api/sessions/${queued.projectId}/${queued.featureId}/backout`)
          .send({ action: 'pause', reason: 'deprioritized' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('paused');
        expect(response.body.session.backoutReason).toBe('deprioritized');
      });
    });

    describe('abandon action', () => {
      it('should abandon an active session', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'abandon' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('failed');
        expect(response.body.session.backoutReason).toBe('user_requested');
      });

      it('should abandon with specific reason', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'abandon', reason: 'blocked' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('failed');
        expect(response.body.session.backoutReason).toBe('blocked');
      });
    });

    describe('queue promotion', () => {
      it('should promote next queued session when active is backed out', async () => {
        // Create active session
        const active = await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // Create queued session
        const queued = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        expect(queued.status).toBe('queued');

        const response = await request(app)
          .post(`/api/sessions/${active.projectId}/${active.featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(200);
        expect(response.body.promotedSession).not.toBeNull();
        expect(response.body.promotedSession.featureId).toBe(queued.featureId);
        expect(response.body.promotedSession.status).toBe('discovery');
      });

      it('should return null promotedSession when no queued sessions', async () => {
        const session = await sessionManager.createSession({
          title: 'Only Session',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(200);
        expect(response.body.promotedSession).toBeNull();
      });
    });

    describe('validation errors', () => {
      it('should return 404 for non-existent session', async () => {
        const response = await request(app)
          .post('/api/sessions/nonexistent/session/backout')
          .send({ action: 'pause' });

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/session not found/i);
      });

      it('should return 400 for completed session', async () => {
        const session = await sessionManager.createSession({
          title: 'Completed Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        await sessionManager.updateSession(session.projectId, session.featureId, {
          status: 'completed',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot back out.*completed/i);
      });

      it('should return 400 for already paused session', async () => {
        const session = await sessionManager.createSession({
          title: 'Paused Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // First pause
        await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'pause' });

        // Try to pause again
        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot back out.*paused/i);
      });

      it('should return 400 for invalid action', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'invalid' });

        expect(response.status).toBe(400);
      });

      it('should return 400 for missing action', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({});

        expect(response.status).toBe(400);
      });

      it('should return 400 for invalid reason', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
          .send({ action: 'pause', reason: 'invalid_reason' });

        expect(response.status).toBe(400);
      });
    });
  });

  describe('POST /api/sessions/:projectId/:featureId/resume', () => {
    describe('immediate resume', () => {
      it('should resume a paused session', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/project',
        });

        // Pause the session first
        await sessionManager.backoutSession(session.projectId, session.featureId, 'pause');

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/resume`)
          .send();

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('discovery');
        expect(response.body.wasQueued).toBe(false);
        expect(response.body.session.backoutReason).toBeNull();
        expect(response.body.session.backoutTimestamp).toBeNull();
      });

      it('should resume to the correct stage', async () => {
        const session = await sessionManager.createSession({
          title: 'Test Feature',
          featureDescription: 'Test description',
          projectPath: '/test/project',
        });

        // Progress to stage 2
        await sessionManager.transitionStage(session.projectId, session.featureId, 2);

        // Pause
        await sessionManager.backoutSession(session.projectId, session.featureId, 'pause');

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/resume`)
          .send();

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('planning');
        expect(response.body.session.currentStage).toBe(2);
        expect(response.body.wasQueued).toBe(false);
      });
    });

    describe('queued resume', () => {
      it('should queue resumed session when another session is active', async () => {
        // Create and keep active session
        const active = await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // Create and pause another session
        const toResume = await sessionManager.createSession({
          title: 'Paused Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        await sessionManager.backoutSession(toResume.projectId, toResume.featureId, 'pause');

        const response = await request(app)
          .post(`/api/sessions/${toResume.projectId}/${toResume.featureId}/resume`)
          .send();

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('queued');
        expect(response.body.wasQueued).toBe(true);
        expect(response.body.session.queuePosition).toBe(1);
      });

      it('should insert at front of queue', async () => {
        // Create active session
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // Create queued session
        const queued = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        // Create and pause another session
        const toResume = await sessionManager.createSession({
          title: 'Paused Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        await sessionManager.backoutSession(toResume.projectId, toResume.featureId, 'pause');

        const response = await request(app)
          .post(`/api/sessions/${toResume.projectId}/${toResume.featureId}/resume`)
          .send();

        expect(response.status).toBe(200);
        expect(response.body.session.queuePosition).toBe(1);

        // Verify original queued session was shifted
        const updatedQueued = await sessionManager.getSession(queued.projectId, queued.featureId);
        expect(updatedQueued!.queuePosition).toBe(2);
      });
    });

    describe('validation errors', () => {
      it('should return 404 for non-existent session', async () => {
        const response = await request(app)
          .post('/api/sessions/nonexistent/session/resume')
          .send();

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/session not found/i);
      });

      it('should return 400 for non-paused session', async () => {
        const session = await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/resume`)
          .send();

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot resume.*discovery/i);
      });

      it('should return 400 for completed session', async () => {
        const session = await sessionManager.createSession({
          title: 'Completed Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        await sessionManager.updateSession(session.projectId, session.featureId, {
          status: 'completed',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/resume`)
          .send();

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot resume.*completed/i);
      });

      it('should return 400 for failed session', async () => {
        const session = await sessionManager.createSession({
          title: 'Failed Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        await sessionManager.updateSession(session.projectId, session.featureId, {
          status: 'failed',
        });

        const response = await request(app)
          .post(`/api/sessions/${session.projectId}/${session.featureId}/resume`)
          .send();

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot resume.*failed/i);
      });
    });
  });

  describe('backout and resume roundtrip', () => {
    it('should allow full pause and resume cycle', async () => {
      const session = await sessionManager.createSession({
        title: 'Roundtrip Test',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      // Progress to stage 3
      await sessionManager.transitionStage(session.projectId, session.featureId, 2);
      await sessionManager.transitionStage(session.projectId, session.featureId, 3);

      // Pause
      const pauseResponse = await request(app)
        .post(`/api/sessions/${session.projectId}/${session.featureId}/backout`)
        .send({ action: 'pause', reason: 'blocked' });

      expect(pauseResponse.status).toBe(200);
      expect(pauseResponse.body.session.status).toBe('paused');
      expect(pauseResponse.body.session.currentStage).toBe(3);

      // Resume
      const resumeResponse = await request(app)
        .post(`/api/sessions/${session.projectId}/${session.featureId}/resume`)
        .send();

      expect(resumeResponse.status).toBe(200);
      expect(resumeResponse.body.session.status).toBe('implementing');
      expect(resumeResponse.body.session.currentStage).toBe(3);
      expect(resumeResponse.body.session.backoutReason).toBeNull();
    });
  });

  describe('queue.reordered event emission', () => {
    let mockIo: jest.Mocked<Server>;
    let mockRoom: { emit: jest.Mock };
    let eventBroadcaster: EventBroadcaster;
    let appWithBroadcaster: Express;

    beforeEach(() => {
      mockRoom = { emit: jest.fn() };
      mockIo = {
        to: jest.fn().mockReturnValue(mockRoom),
      } as unknown as jest.Mocked<Server>;
      eventBroadcaster = new EventBroadcaster(mockIo);
      const result = createApp(storage, sessionManager, eventBroadcaster);
      appWithBroadcaster = result.app;
    });

    it('should emit queue.reordered event when queued session is backed out', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      // Create two queued sessions
      const queued1 = await sessionManager.createSession({
        title: 'Queued Feature 1',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      const queued2 = await sessionManager.createSession({
        title: 'Queued Feature 2',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      expect(queued1.status).toBe('queued');
      expect(queued2.status).toBe('queued');
      expect(queued1.queuePosition).toBe(1);
      expect(queued2.queuePosition).toBe(2);

      // Back out the first queued session
      const response = await request(appWithBroadcaster)
        .post(`/api/sessions/${queued1.projectId}/${queued1.featureId}/backout`)
        .send({ action: 'abandon', reason: 'user_requested' });

      expect(response.status).toBe(200);

      // Verify queue.reordered event was emitted
      expect(mockIo.to).toHaveBeenCalledWith(queued1.projectId);
      expect(mockRoom.emit).toHaveBeenCalledWith(
        'queue.reordered',
        expect.objectContaining({
          projectId: queued1.projectId,
          queuedSessions: expect.arrayContaining([
            expect.objectContaining({
              featureId: queued2.featureId,
              queuePosition: 1, // Position recalculated after removal
            }),
          ]),
          timestamp: expect.any(String),
        })
      );

      // Verify only the remaining session is in the event
      const queueReorderedCall = mockRoom.emit.mock.calls.find(
        (call: unknown[]) => call[0] === 'queue.reordered'
      );
      expect(queueReorderedCall[1].queuedSessions).toHaveLength(1);
    });

    it('should emit queue.reordered event with empty array when last queued session is backed out', async () => {
      // Create active session
      const active = await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      // Create one queued session
      const queued = await sessionManager.createSession({
        title: 'Queued Feature',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      expect(queued.status).toBe('queued');

      // Back out the queued session
      const response = await request(appWithBroadcaster)
        .post(`/api/sessions/${queued.projectId}/${queued.featureId}/backout`)
        .send({ action: 'abandon', reason: 'user_requested' });

      expect(response.status).toBe(200);

      // Verify queue.reordered event was emitted with empty array
      const queueReorderedCall = mockRoom.emit.mock.calls.find(
        (call: unknown[]) => call[0] === 'queue.reordered'
      );
      expect(queueReorderedCall).toBeDefined();
      expect(queueReorderedCall[1].queuedSessions).toHaveLength(0);
    });

    it('should emit queue.reordered event when active session is backed out and promotes queued session', async () => {
      // Create active session
      const active = await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      // Create two queued sessions
      const queued1 = await sessionManager.createSession({
        title: 'Queued Feature 1',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      const queued2 = await sessionManager.createSession({
        title: 'Queued Feature 2',
        featureDescription: 'Test',
        projectPath: '/test/project',
      });

      // Clear previous emit calls
      mockRoom.emit.mockClear();
      mockIo.to.mockClear();

      // Back out the active session (should promote queued1)
      const response = await request(appWithBroadcaster)
        .post(`/api/sessions/${active.projectId}/${active.featureId}/backout`)
        .send({ action: 'pause' });

      expect(response.status).toBe(200);
      expect(response.body.promotedSession).not.toBeNull();
      expect(response.body.promotedSession.featureId).toBe(queued1.featureId);

      // Verify queue.reordered event was emitted
      const queueReorderedCall = mockRoom.emit.mock.calls.find(
        (call: unknown[]) => call[0] === 'queue.reordered'
      );
      expect(queueReorderedCall).toBeDefined();

      // After promotion, only queued2 should remain in queue
      expect(queueReorderedCall[1].queuedSessions).toHaveLength(1);
      expect(queueReorderedCall[1].queuedSessions[0].featureId).toBe(queued2.featureId);
      expect(queueReorderedCall[1].queuedSessions[0].queuePosition).toBe(1);
    });
  });
});
