import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import os from 'os';
import { FileStorageService } from './data/FileStorageService';
import { SessionManager } from './services/SessionManager';
import { GracefulShutdown } from './services/GracefulShutdown';
import { EventBroadcaster } from './services/EventBroadcaster';
import { createApp } from './app';

// Initialize services
const dataDir = process.env.DATA_DIR || path.join(os.homedir(), '.claude-web');
const storage = new FileStorageService(dataDir);
const sessionManager = new SessionManager(storage);

// Create HTTP server first to get Socket.IO instance
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : true,  // Allow all origins in dev for mobile access
  },
});

// Create EventBroadcaster with Socket.IO
const eventBroadcaster = new EventBroadcaster(io);

// Create Express app with all dependencies
const { app, resumeStuckSessions } = createApp(storage, sessionManager, eventBroadcaster);

// Attach Express app to HTTP server AFTER Socket.IO is set up
// Use a wrapper to prevent Express from processing Socket.IO requests
httpServer.on('request', (req, res) => {
  // Skip socket.io paths - let Socket.IO handle them
  if (req.url?.startsWith('/socket.io')) {
    return;
  }
  app(req, res);
});

// Handle Socket.IO engine errors to prevent crashes
io.engine.on('connection_error', (err) => {
  console.error('Socket.IO connection error:', err.message);
});

// Handle uncaught errors on the httpServer
httpServer.on('error', (err) => {
  console.error('HTTP Server error:', err.message);
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  // Don't exit - keep running
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  // Don't exit - keep running
});

// Socket.IO for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-session', (sessionId: string) => {
    socket.join(sessionId);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('leave-session', (sessionId: string) => {
    socket.leave(sessionId);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3333;
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(Number(PORT), HOST, async () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Data directory: ${dataDir}`);

  // Resume any sessions that were interrupted by server restart
  await resumeStuckSessions();
});

// Set up graceful shutdown (README lines 669-690)
const gracefulShutdown = new GracefulShutdown(httpServer, io, {
  timeoutMs: 30000, // 30 seconds for graceful shutdown
});

// Register signal handlers
gracefulShutdown.registerSignalHandlers();

export { app, io, sessionManager, gracefulShutdown };
