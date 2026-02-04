import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster 
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: '#363636',
          color: '#fff',
          borderRadius: '12px',
          padding: '16px',
          fontSize: '14px',
        },
        success: {
          iconTheme: {
            primary: '#198754',
            secondary: '#fff',
          },
        },
        error: {
          iconTheme: {
            primary: '#dc3545',
            secondary: '#fff',
          },
        },
      }}
    />
  </React.StrictMode>,
);

