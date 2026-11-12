import './style.css';
import { Game } from './core/Game.js';
import { setupInstall } from './ui/install.js';

const game = new Game(document.getElementById('view'));
game.start();
setupInstall();

// Handy while developing: inspect the running game from the browser console.
if (import.meta.env.DEV) window.__game = game;
