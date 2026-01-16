import {
  SessionBackedOutEvent,
  SessionResumedEvent,
  BackoutAction,
  ServerToClientEvents,
} from '@claude-code-web/shared';

describe('Backout/Resume Event Types', () => {
  describe('BackoutAction type', () => {
    it('should accept "pause" action', () => {
      const action: BackoutAction = 'pause';
      expect(action).toBe('pause');
    });

    it('should accept "abandon" action', () => {
      const action: BackoutAction = 'abandon';
      expect(action).toBe('abandon');
    });
  });

  describe('SessionBackedOutEvent', () => {
    describe('required fields', () => {
      it('should have all required fields', () => {
        const event: SessionBackedOutEvent = {
          projectId: 'project-123',
          featureId: 'feature-456',
          sessionId: 'session-789',
          action: 'pause',
          reason: 'user_requested',
          newStatus: 'paused',
          previousStage: 2,
          nextSessionId: null,
          timestamp: '2026-01-16T12:00:00Z',
        };

        expect(event.projectId).toBe('project-123');
        expect(event.featureId).toBe('feature-456');
        expect(event.sessionId).toBe('session-789');
        expect(event.action).toBe('pause');
        expect(event.reason).toBe('user_requested');
        expect(event.newStatus).toBe('paused');
        expect(event.previousStage).toBe(2);
        expect(event.nextSessionId).toBeNull();
        expect(event.timestamp).toBe('2026-01-16T12:00:00Z');
      });
    });

    describe('action field', () => {
      it('should accept pause action with paused status', () => {
        const event: SessionBackedOutEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'pause',
          reason: 'blocked',
          newStatus: 'paused',
          previousStage: 3,
          nextSessionId: null,
          timestamp: new Date().toISOString(),
        };

        expect(event.action).toBe('pause');
        expect(event.newStatus).toBe('paused');
      });

      it('should accept abandon action with failed status', () => {
        const event: SessionBackedOutEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'abandon',
          reason: 'deprioritized',
          newStatus: 'failed',
          previousStage: 1,
          nextSessionId: null,
          timestamp: new Date().toISOString(),
        };

        expect(event.action).toBe('abandon');
        expect(event.newStatus).toBe('failed');
      });
    });

    describe('reason field', () => {
      it('should accept user_requested reason', () => {
        const event: SessionBackedOutEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'pause',
          reason: 'user_requested',
          newStatus: 'paused',
          previousStage: 1,
          nextSessionId: null,
          timestamp: new Date().toISOString(),
        };

        expect(event.reason).toBe('user_requested');
      });

      it('should accept blocked reason', () => {
        const event: SessionBackedOutEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'pause',
          reason: 'blocked',
          newStatus: 'paused',
          previousStage: 2,
          nextSessionId: null,
          timestamp: new Date().toISOString(),
        };

        expect(event.reason).toBe('blocked');
      });

      it('should accept deprioritized reason', () => {
        const event: SessionBackedOutEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'abandon',
          reason: 'deprioritized',
          newStatus: 'failed',
          previousStage: 4,
          nextSessionId: null,
          timestamp: new Date().toISOString(),
        };

        expect(event.reason).toBe('deprioritized');
      });
    });

    describe('nextSessionId field', () => {
      it('should accept null when no session was promoted', () => {
        const event: SessionBackedOutEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'pause',
          reason: 'user_requested',
          newStatus: 'paused',
          previousStage: 1,
          nextSessionId: null,
          timestamp: new Date().toISOString(),
        };

        expect(event.nextSessionId).toBeNull();
      });

      it('should accept feature ID when session was promoted', () => {
        const event: SessionBackedOutEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'pause',
          reason: 'user_requested',
          newStatus: 'paused',
          previousStage: 2,
          nextSessionId: 'promoted-feature-id',
          timestamp: new Date().toISOString(),
        };

        expect(event.nextSessionId).toBe('promoted-feature-id');
      });
    });

    describe('previousStage field', () => {
      it('should accept stages 0-6', () => {
        const stages = [0, 1, 2, 3, 4, 5, 6];

        stages.forEach(stage => {
          const event: SessionBackedOutEvent = {
            projectId: 'proj',
            featureId: 'feat',
            sessionId: 'sess',
            action: 'pause',
            reason: 'user_requested',
            newStatus: 'paused',
            previousStage: stage,
            nextSessionId: null,
            timestamp: new Date().toISOString(),
          };

          expect(event.previousStage).toBe(stage);
        });
      });
    });
  });

  describe('SessionResumedEvent', () => {
    describe('required fields', () => {
      it('should have all required fields', () => {
        const event: SessionResumedEvent = {
          projectId: 'project-123',
          featureId: 'feature-456',
          sessionId: 'session-789',
          newStatus: 'planning',
          resumedStage: 2,
          wasQueued: false,
          queuePosition: null,
          timestamp: '2026-01-16T12:00:00Z',
        };

        expect(event.projectId).toBe('project-123');
        expect(event.featureId).toBe('feature-456');
        expect(event.sessionId).toBe('session-789');
        expect(event.newStatus).toBe('planning');
        expect(event.resumedStage).toBe(2);
        expect(event.wasQueued).toBe(false);
        expect(event.queuePosition).toBeNull();
        expect(event.timestamp).toBe('2026-01-16T12:00:00Z');
      });
    });

    describe('immediate resume (not queued)', () => {
      it('should have wasQueued=false and queuePosition=null', () => {
        const event: SessionResumedEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          newStatus: 'discovery',
          resumedStage: 1,
          wasQueued: false,
          queuePosition: null,
          timestamp: new Date().toISOString(),
        };

        expect(event.wasQueued).toBe(false);
        expect(event.queuePosition).toBeNull();
      });

      it('should have appropriate status for resumed stage', () => {
        const stageStatusPairs: Array<[number, string]> = [
          [1, 'discovery'],
          [2, 'planning'],
          [3, 'implementing'],
          [4, 'pr_creation'],
          [5, 'pr_review'],
          [6, 'final_approval'],
        ];

        stageStatusPairs.forEach(([stage, status]) => {
          const event: SessionResumedEvent = {
            projectId: 'proj',
            featureId: 'feat',
            sessionId: 'sess',
            newStatus: status as SessionResumedEvent['newStatus'],
            resumedStage: stage,
            wasQueued: false,
            queuePosition: null,
            timestamp: new Date().toISOString(),
          };

          expect(event.resumedStage).toBe(stage);
          expect(event.newStatus).toBe(status);
        });
      });
    });

    describe('queued resume', () => {
      it('should have wasQueued=true and valid queuePosition', () => {
        const event: SessionResumedEvent = {
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          newStatus: 'queued',
          resumedStage: 0,
          wasQueued: true,
          queuePosition: 1,
          timestamp: new Date().toISOString(),
        };

        expect(event.wasQueued).toBe(true);
        expect(event.queuePosition).toBe(1);
        expect(event.newStatus).toBe('queued');
        expect(event.resumedStage).toBe(0);
      });

      it('should accept various queue positions', () => {
        const positions = [1, 2, 3, 5, 10];

        positions.forEach(position => {
          const event: SessionResumedEvent = {
            projectId: 'proj',
            featureId: 'feat',
            sessionId: 'sess',
            newStatus: 'queued',
            resumedStage: 0,
            wasQueued: true,
            queuePosition: position,
            timestamp: new Date().toISOString(),
          };

          expect(event.queuePosition).toBe(position);
        });
      });
    });
  });

  describe('ServerToClientEvents integration', () => {
    describe('session.backedout handler', () => {
      it('should accept SessionBackedOutEvent in handler', () => {
        const handler: ServerToClientEvents['session.backedout'] = (data: SessionBackedOutEvent) => {
          expect(data.projectId).toBeDefined();
          expect(data.featureId).toBeDefined();
          expect(data.sessionId).toBeDefined();
          expect(data.action).toBeDefined();
          expect(data.reason).toBeDefined();
          expect(data.newStatus).toBeDefined();
          expect(data.previousStage).toBeDefined();
          expect(data.timestamp).toBeDefined();
        };

        handler({
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'pause',
          reason: 'user_requested',
          newStatus: 'paused',
          previousStage: 3,
          nextSessionId: null,
          timestamp: new Date().toISOString(),
        });
      });

      it('should handle event with promoted session', () => {
        const handler: ServerToClientEvents['session.backedout'] = (data: SessionBackedOutEvent) => {
          if (data.nextSessionId) {
            expect(typeof data.nextSessionId).toBe('string');
          }
        };

        handler({
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          action: 'pause',
          reason: 'blocked',
          newStatus: 'paused',
          previousStage: 2,
          nextSessionId: 'next-feature',
          timestamp: new Date().toISOString(),
        });
      });
    });

    describe('session.resumed handler', () => {
      it('should accept SessionResumedEvent in handler', () => {
        const handler: ServerToClientEvents['session.resumed'] = (data: SessionResumedEvent) => {
          expect(data.projectId).toBeDefined();
          expect(data.featureId).toBeDefined();
          expect(data.sessionId).toBeDefined();
          expect(data.newStatus).toBeDefined();
          expect(data.resumedStage).toBeDefined();
          expect(typeof data.wasQueued).toBe('boolean');
          expect(data.timestamp).toBeDefined();
        };

        handler({
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          newStatus: 'discovery',
          resumedStage: 1,
          wasQueued: false,
          queuePosition: null,
          timestamp: new Date().toISOString(),
        });
      });

      it('should handle event with queued session', () => {
        const handler: ServerToClientEvents['session.resumed'] = (data: SessionResumedEvent) => {
          if (data.wasQueued) {
            expect(data.newStatus).toBe('queued');
            expect(data.queuePosition).not.toBeNull();
            expect(typeof data.queuePosition).toBe('number');
          }
        };

        handler({
          projectId: 'proj',
          featureId: 'feat',
          sessionId: 'sess',
          newStatus: 'queued',
          resumedStage: 0,
          wasQueued: true,
          queuePosition: 1,
          timestamp: new Date().toISOString(),
        });
      });
    });
  });

  describe('Type exports', () => {
    it('should export SessionBackedOutEvent type', () => {
      const event: SessionBackedOutEvent = {
        projectId: 'proj',
        featureId: 'feat',
        sessionId: 'sess',
        action: 'pause',
        reason: 'user_requested',
        newStatus: 'paused',
        previousStage: 1,
        nextSessionId: null,
        timestamp: new Date().toISOString(),
      };

      expect(event).toBeDefined();
    });

    it('should export SessionResumedEvent type', () => {
      const event: SessionResumedEvent = {
        projectId: 'proj',
        featureId: 'feat',
        sessionId: 'sess',
        newStatus: 'discovery',
        resumedStage: 1,
        wasQueued: false,
        queuePosition: null,
        timestamp: new Date().toISOString(),
      };

      expect(event).toBeDefined();
    });

    it('should export BackoutAction type', () => {
      const action: BackoutAction = 'abandon';

      expect(action).toBe('abandon');
    });
  });
});
