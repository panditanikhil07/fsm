import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/console.css';
import './styles/base.css';
import './styles/builder.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
