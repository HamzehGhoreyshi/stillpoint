import './style.css';
import { Game } from './core/Game.js';

const game = new Game(document.getElementById('view'));
game.start();

// Handy while developing: inspect the running game from the browser console.
if (import.meta.env.DEV) window.__game = game;
