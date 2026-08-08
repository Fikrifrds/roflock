import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Playground } from './Playground.js';
import { decodeShareLink } from './share.js';

const shared = decodeShareLink(window.location.hash);
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Playground {...(shared === undefined ? {} : { initialSource: shared })} />
    </StrictMode>,
  );
}
