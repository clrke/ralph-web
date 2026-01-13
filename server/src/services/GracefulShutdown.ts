import { Server } from 'http';
import { Server as SocketIOServer } from 'socket.io';

export interface GracefulShutdownOptions {
  timeoutMs?: number;
}

type CleanupTask = () => Promise<void>;

/**
 * Handles graceful shutdown of the server (README lines 669-690)
 *
 * Shutdown sequence:
 * 1. Stop accepting new requests
 * 2. Run cleanup tasks (e.g., wait for active Claude processes)
 * 3. Disconnect WebSocket clients
 * 4. Close WebSocket server
 * 5. Close HTTP server
 * 6. Exit with code 0
 */
export class GracefulShutdown {
  private isShuttingDown = false;
  private cleanupTasks: CleanupTask[] = [];
  private readonly timeoutMs: number;

  constructor(
    private readonly httpServer: Server,
    private readonly io: SocketIOServer,
    options: GracefulShutdownOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Add a cleanup task to run during shutdown
   * (e.g., waiting for Claude processes to complete)
   */
  addCleanupTask(task: CleanupTask): void {
    this.cleanupTasks.push(task);
  }

  /**
   * Register signal handlers for SIGTERM and SIGINT
   */
  registerSignalHandlers(): void {
    process.on('SIGTERM', () => this.handleSignal('SIGTERM'));
    process.on('SIGINT', () => this.handleSignal('SIGINT'));
  }

  private async handleSignal(signal: string): Promise<void> {
    console.log(`\nReceived ${signal} signal`);
    await this.shutdown();
    process.exit(0);
  }

  /**
   * Perform graceful shutdown
   */
  async shutdown(): Promise<void> {
    // Prevent multiple shutdowns
    if (this.isShuttingDown) {
      console.log('Shutdown already in progress...');
      return;
    }
    this.isShuttingDown = true;

    console.log('Starting graceful shutdown...');

    // Set up force shutdown timeout
    const forceShutdownTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, this.timeoutMs);

    try {
      // Step 1: Run cleanup tasks (e.g., wait for Claude processes)
      console.log('Running cleanup tasks...');
      await this.runCleanupTasks();

      // Step 2: Disconnect all WebSocket clients
      console.log('Disconnecting WebSocket clients...');
      this.io.disconnectSockets(true);

      // Step 3: Close Socket.IO server
      console.log('Closing Socket.IO server...');
      await this.closeSocketIO();

      // Step 4: Close HTTP server
      console.log('Closing HTTP server...');
      await this.closeHttpServer();

      console.log('Graceful shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
    } finally {
      clearTimeout(forceShutdownTimer);
    }
  }

  private async runCleanupTasks(): Promise<void> {
    for (const task of this.cleanupTasks) {
      try {
        await task();
      } catch (error) {
        console.error('Cleanup task failed:', error);
        // Continue with other tasks even if one fails
      }
    }
  }

  private closeSocketIO(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        resolve();
      });
    });
  }

  private closeHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
