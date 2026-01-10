import { GracefulShutdown } from '../../server/src/services/GracefulShutdown';
import { Server } from 'http';
import { Server as SocketIOServer } from 'socket.io';

describe('GracefulShutdown', () => {
  let mockHttpServer: Partial<Server>;
  let mockIoServer: Partial<SocketIOServer>;
  let shutdown: GracefulShutdown;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockHttpServer = {
      close: jest.fn((callback?: (err?: Error) => void) => {
        if (callback) callback();
        return mockHttpServer as Server;
      }),
    };

    mockIoServer = {
      close: jest.fn((callback?: () => void) => {
        if (callback) callback();
      }),
      disconnectSockets: jest.fn(),
    };

    shutdown = new GracefulShutdown(
      mockHttpServer as Server,
      mockIoServer as SocketIOServer
    );

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('shutdown', () => {
    it('should disconnect all sockets', async () => {
      await shutdown.shutdown();

      expect(mockIoServer.disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('should close the Socket.IO server', async () => {
      await shutdown.shutdown();

      expect(mockIoServer.close).toHaveBeenCalled();
    });

    it('should close the HTTP server', async () => {
      await shutdown.shutdown();

      expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it('should log shutdown messages', async () => {
      await shutdown.shutdown();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/graceful shutdown/i));
    });

    it('should only execute once even if called multiple times', async () => {
      await Promise.all([
        shutdown.shutdown(),
        shutdown.shutdown(),
        shutdown.shutdown(),
      ]);

      // Should only be called once
      expect(mockIoServer.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerSignalHandlers', () => {
    it('should register SIGTERM handler', () => {
      const processSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

      shutdown.registerSignalHandlers();

      expect(processSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      processSpy.mockRestore();
    });

    it('should register SIGINT handler', () => {
      const processSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

      shutdown.registerSignalHandlers();

      expect(processSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      processSpy.mockRestore();
    });
  });

  describe('with cleanup tasks', () => {
    it('should execute cleanup tasks before shutdown', async () => {
      const cleanupFn = jest.fn().mockResolvedValue(undefined);
      shutdown.addCleanupTask(cleanupFn);

      await shutdown.shutdown();

      expect(cleanupFn).toHaveBeenCalled();
    });

    it('should continue shutdown even if cleanup task fails', async () => {
      const failingCleanup = jest.fn().mockRejectedValue(new Error('Cleanup failed'));
      shutdown.addCleanupTask(failingCleanup);

      await shutdown.shutdown();

      expect(failingCleanup).toHaveBeenCalled();
      expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it('should execute multiple cleanup tasks', async () => {
      const cleanup1 = jest.fn().mockResolvedValue(undefined);
      const cleanup2 = jest.fn().mockResolvedValue(undefined);
      shutdown.addCleanupTask(cleanup1);
      shutdown.addCleanupTask(cleanup2);

      await shutdown.shutdown();

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('should accept custom timeout', () => {
      const customShutdown = new GracefulShutdown(
        mockHttpServer as Server,
        mockIoServer as SocketIOServer,
        { timeoutMs: 5000 }
      );

      expect(customShutdown).toBeDefined();
    });
  });
});
