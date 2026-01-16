import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from '@claude-code-web/shared';

// Re-export the shared socket event types for convenience
export type { ServerToClientEvents, ClientToServerEvents };

// Alias for backward compatibility
export type SocketEvents = ServerToClientEvents;

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io('/', {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function connectToSession(projectId: string, featureId: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  const socket = getSocket();

  if (!socket.connected) {
    socket.connect();
  }

  const room = `${projectId}/${featureId}`;
  socket.emit('join-session', room);

  return socket;
}

export function disconnectFromSession(projectId: string, featureId: string): void {
  const socket = getSocket();

  if (socket.connected) {
    const room = `${projectId}/${featureId}`;
    socket.emit('leave-session', room);
  }
}

export function disconnect(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}

export function connectToProject(projectId: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  const socket = getSocket();

  if (!socket.connected) {
    socket.connect();
  }

  // Join the project room for queue events
  socket.emit('join-session', projectId);

  return socket;
}

export function disconnectFromProject(projectId: string): void {
  const socket = getSocket();

  if (socket.connected) {
    socket.emit('leave-session', projectId);
  }
}
