import { createRoot } from 'react-dom/client';

import App from '@/src/App';
import '@/app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root application mount.');

createRoot(root).render(<App />);
