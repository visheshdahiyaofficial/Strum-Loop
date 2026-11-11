import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Not a hot-reload boundary on purpose: editing this file reloads every open page.
createRoot(document.getElementById('root')!).render(<App />);
