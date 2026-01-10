import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import os from 'os';
import { FileStorageService } from './data/FileStorageService';
import { SessionManager } from './services/SessionManager';
import { GracefulShutdown } from './services/GracefulShutdown';
import { createApp } from './app';

// Initialize services
const dataDir = process.env.DATA_DIR || path.join(os.homedir(), '.clrke');
const storage = new FileStorageService(dataDir);
const sessionManager = new SessionManager(storage);

// Create Express app
const app = createApp(storage, sessionManager);

// Create HTTP server with Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'http://localhost:5174'],
  },
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
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${dataDir}`);
});

// Set up graceful shutdown (README lines 669-690)
const gracefulShutdown = new GracefulShutdown(httpServer, io, {
  timeoutMs: 30000, // 30 seconds for graceful shutdown
});

// Register signal handlers
gracefulShutdown.registerSignalHandlers();

export { app, io, sessionManager, gracefulShutdown };
