import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Studio needs an element with id "root" in index.html.');
}

createRoot(container).render(<StrictMode />);
