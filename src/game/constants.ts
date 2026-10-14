export const LANE_X = [-2.2, 0, 2.2]; // X positions of the 3 lanes
export const PLAYER_Z = 0; // the player stays fixed; the world moves towards +Z

export const SPAWN_Z = -90; // obstacles appear far away (negative Z)
export const DESPAWN_Z = 14; // recycled after passing the camera

export const BASE_SPEED = 17; // units/sec at start
export const MAX_SPEED = 44;
export const SPEED_RAMP = 0.32; // speed increase per second

export const GRAVITY = -60;
export const JUMP_V = 17; // initial jump velocity
export const SLIDE_TIME = 0.55; // slide duration (sec)

export const LANE_LERP = 12; // lane change speed

export const SEGMENT_LEN = 22;
export const SEGMENT_COUNT = 7;
export const TRACK_HALF_W = 3.6;

export const PLAYER_W = 0.9;
export const PLAYER_D = 0.9;
export const PLAYER_H = 1.7;
export const PLAYER_H_SLIDE = 0.8;

// Obstacle heights
export const BLOCK_H = 1.1; // jumped over
export const OVERHEAD_Y = 1.5; // overhead bar — slide underneath
export const WALL_H = 2.6; // wall — change lane

export const CORE_SCORE = 50; // base bonus per core (× the combo multiplier)

// Lives: with N lives, the next one comes after N × LIFE_STEP more points (counter resets whenever N changes).
export const LIFE_STEP = 10000; // production value (may later depend on the chosen difficulty)
export const MAX_LIVES = 5;
export const RESPAWN_TIME = 3; // seconds the character stops and blinks after losing a life (player may act meanwhile)
