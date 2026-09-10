import { Film } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';

export function App() {
  return <div className="app-shell"><nav className="topbar"><Link to="/" className="brand" aria-label="BreezeReels home"><Film size={21} aria-hidden="true" /> BreezeReels</Link><Link to="/privacy">Privacy</Link></nav><main><Outlet /></main></div>;
}
