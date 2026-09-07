import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register Service Worker with auto-update
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('New SG Bus Kaki version available. Auto-updating...');
    updateSW(true);
  },
  onOfflineReady() {
    console.log('SG Bus Kaki ready for offline commuter use in MRT tunnels.');
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
