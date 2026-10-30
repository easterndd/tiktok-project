import { createRoot } from 'react-dom/client';
import React from 'react';

function BloomReelSetup() {
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'sans-serif' }}>
    <div><h1>BloomReel</h1><p>The Mini experience is awaiting its approved content and advertising strategy.</p></div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<BloomReelSetup />);
