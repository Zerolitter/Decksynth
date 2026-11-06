import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './next-layout.css';
import './hardware-refinement.css';
import './performance.css';
const root=document.getElementById('root');
if(!root)throw new Error('Missing DeckSynth root node');
createRoot(root).render(<React.StrictMode><App/></React.StrictMode>);
