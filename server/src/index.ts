import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import os from 'os';
import { FileStorageService } from './data/FileStorageService';
import { SessionManager } from './services/SessionManager';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'http://localhost:5174'],
  },
});

// Middleware
app.use(express.json());

// Initialize services
const dataDir = process.env.DATA_DIR || path.join(os.homedir(), '.clrke');
const storage = new FileStorageService(dataDir);
const sessionManager = new SessionManager(storage);

// API Routes

// Create session
app.post('/api/sessions', async (req, res) => {
  try {
    const session = await sessionManager.createSession(req.body);
    res.status(201).json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create session';
    res.status(400).json({ error: message });
  }
});

// Get session
app.get('/api/sessions/:projectId/:featureId', async (req, res) => {
  try {
    const { projectId, featureId } = req.params;
    const session = await sessionManager.getSession(projectId, featureId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get session';
    res.status(500).json({ error: message });
  }
});

// Update session
app.patch('/api/sessions/:projectId/:featureId', async (req, res) => {
  try {
    const { projectId, featureId } = req.params;
    const session = await sessionManager.updateSession(projectId, featureId, req.body);
    res.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update session';
    res.status(400).json({ error: message });
  }
});

// List sessions for project
app.get('/api/sessions/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const sessions = await sessionManager.listSessions(projectId);
    res.json(sessions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list sessions';
    res.status(500).json({ error: message });
  }
});

// Transition stage
app.post('/api/sessions/:projectId/:featureId/transition', async (req, res) => {
  try {
    const { projectId, featureId } = req.params;
    const { targetStage } = req.body;
    const session = await sessionManager.transitionStage(projectId, featureId, targetStage);
    res.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to transition stage';
    res.status(400).json({ error: message });
  }
});

// Get plan
app.get('/api/sessions/:projectId/:featureId/plan', async (req, res) => {
  try {
    const { projectId, featureId } = req.params;
    const plan = await storage.readJson(`${projectId}/${featureId}/plan.json`);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    res.json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get plan';
    res.status(500).json({ error: message });
  }
});

// Get questions
app.get('/api/sessions/:projectId/:featureId/questions', async (req, res) => {
  try {
    const { projectId, featureId } = req.params;
    const questions = await storage.readJson(`${projectId}/${featureId}/questions.json`);
    res.json(questions || { questions: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get questions';
    res.status(500).json({ error: message });
  }
});

// Approve plan
app.post('/api/sessions/:projectId/:featureId/plan/approve', async (req, res) => {
  try {
    const { projectId, featureId } = req.params;
    const planPath = `${projectId}/${featureId}/plan.json`;
    const plan = await storage.readJson<{ isApproved: boolean }>(planPath);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    plan.isApproved = true;
    await storage.writeJson(planPath, plan);
    res.json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to approve plan';
    res.status(500).json({ error: message });
  }
});

// Request plan changes
app.post('/api/sessions/:projectId/:featureId/plan/request-changes', async (req, res) => {
  try {
    const { projectId, featureId } = req.params;
    const { feedback } = req.body;
    // TODO: Trigger Claude to revise plan based on feedback
    res.json({ success: true, feedback });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to request changes';
    res.status(500).json({ error: message });
  }
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

export { app, io, sessionManager };
