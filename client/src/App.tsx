import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import NewSession from './pages/NewSession';
import SessionView from './pages/SessionView';
import EditSession from './pages/EditSession';

function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewSession />} />
        <Route path="/session/:projectId/:featureId/edit" element={<EditSession />} />
        <Route path="/session/:projectId/:featureId" element={<SessionView />} />
      </Routes>
    </div>
  );
}

export default App;
