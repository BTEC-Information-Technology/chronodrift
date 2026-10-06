// Types shared between the generator, difficulty and Game.
// "Simple" types (one cell) — used in the difficulty weights and in rows.
export type SimpleType = 'block' | 'overhead' | 'wall' | 'core';
// All types (trains span several rows).
export type ObType = SimpleType | 'trainBlock' | 'trainRide';
