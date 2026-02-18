import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import WorkerKiosk from './pages/WorkerKiosk';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/worker" element={<WorkerKiosk />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
