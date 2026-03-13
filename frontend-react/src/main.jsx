/**
 * /frontend-react/src/main.jsx
 * Vite entry point — bootstraps the React application.
 */
import React    from 'react';
import ReactDOM from 'react-dom/client';
import App      from './App.jsx';
import './index.css'; // Tailwind base styles

// Remove the pre-React loading screen once React has mounted
const loadingScreen = document.getElementById('loading-screen');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Fade out the loading overlay after the first render
if (loadingScreen) {
  loadingScreen.style.opacity = '0';
  loadingScreen.style.pointerEvents = 'none';
  setTimeout(() => loadingScreen.remove(), 300); // matches the CSS transition
}
