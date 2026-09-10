import { LayoutDashboard, ListVideo, Upload } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function AdminApp() {
  return <div className="admin-layout"><aside><h1>BreezeReels</h1><nav><a href="#albums"><ListVideo size={18} /> Albums</a><a href="#uploads"><Upload size={18} /> Upload jobs</a><a href="#overview"><LayoutDashboard size={18} /> Overview</a></nav></aside><main><p className="eyebrow">OPERATIONS</p><h2>Content control center</h2><section className="notice"><h3>Admin API is not connected yet</h3><p>This protected surface is intentionally separate from the TikTok Mini code asset. M2 adds admin authentication, album CRUD, upload jobs, review, listing, and audit logs.</p></section></main></div>;
}

createRoot(document.getElementById('root')!).render(<AdminApp />);
