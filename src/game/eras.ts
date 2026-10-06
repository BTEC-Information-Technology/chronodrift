// Era palettes (placeholder). The Synty art will be mounted into these slots.
// Each era = a distinct neon palette; the transition between them = the "time rift".
export interface EraPalette {
  name: string;
  bg: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  ground: number;
  groundEmissive: number;
  railL: number;
  railR: number;
  line: number;
  player: number;
  block: number;
  overhead: number;
  wall: number;
  core: number;
  // Sky (dome with gradient + stars)
  skyTop: number; // zenith colour
  skyHorizon: number; // horizon colour
  starOpacity: number; // 0 (day) .. 1 (night)
  groundOpacity: number; // 1 = opaque; <1 = semi-transparent road (void below)
  planetOpacity: number; // 0..1 visibility of the planet fragments (Unknown Future only)
}

// Colour of the time "rift" — the flash when crossing between eras.
export const RIFT_COLOR = 0xcfeaff;

// Index 0 = Neo-Cyberpunk = the "home" era (dominant). 1..3 = rare excursions.
export const ERAS: EraPalette[] = [
  {
    name: 'Neo-Cyberpunk',
    bg: 0x05010f, fog: 0x0a0420,
    hemiSky: 0x6688ff, hemiGround: 0x140022,
    ground: 0x0b0820, groundEmissive: 0x0a0526,
    railL: 0x00eaff, railR: 0xff36c8, line: 0x3344aa,
    player: 0x00eaff,
    block: 0xff5a1e, overhead: 0xff36c8, wall: 0xff2040, core: 0x7ef9ff,
    skyTop: 0x05030f, skyHorizon: 0x3a1470, starOpacity: 0.7,
    groundOpacity: 1, planetOpacity: 0,
  },
  {
    name: 'Prehistoric',
    bg: 0x12301c, fog: 0x3a6a44,
    hemiSky: 0xc8f0a8, hemiGround: 0x163210,
    ground: 0x123512, groundEmissive: 0x18421e,
    railL: 0x59ff7a, railR: 0xffd23a, line: 0x2a5a2e,
    player: 0xbaff66,
    block: 0xff9a30, overhead: 0xffe24a, wall: 0xff6a3a, core: 0xe6ff7e,
    skyTop: 0x5aa6d8, skyHorizon: 0xd6e8a0, starOpacity: 0.0,
    groundOpacity: 1, planetOpacity: 0,
  },
  {
    name: 'Ancient-Mythological',
    bg: 0x0d0a04, fog: 0x261a08,
    hemiSky: 0xffe6a8, hemiGround: 0x2a1c08,
    ground: 0x1a1408, groundEmissive: 0x3a2a10,
    railL: 0xffd24a, railR: 0xfff0c0, line: 0x5a4422,
    player: 0xffe9a6,
    block: 0xff8c3a, overhead: 0xffe24a, wall: 0xff5a4a, core: 0xfff0a0,
    skyTop: 0x2e74c4, skyHorizon: 0xf2c878, starOpacity: 0.0,
    groundOpacity: 1, planetOpacity: 0,
  },
  {
    name: 'Solarpunk',
    bg: 0x06140e, fog: 0x10401e,
    hemiSky: 0xd6ffb0, hemiGround: 0x123012,
    ground: 0x0e2614, groundEmissive: 0x12401e,
    railL: 0x6cff9a, railR: 0xffe06a, line: 0x2a5a30,
    player: 0xa8ff80,
    block: 0xffc24a, overhead: 0xbfff6a, wall: 0xff7a5a, core: 0xeaffa0,
    skyTop: 0x2e6fc0, skyHorizon: 0xd2eeff, starOpacity: 0.0,
    groundOpacity: 1, planetOpacity: 0,
  },
  {
    name: 'Unknown Future',
    bg: 0x01020a, fog: 0x05081a,
    hemiSky: 0x4a5a9a, hemiGround: 0x05060f,
    ground: 0x0a0c1e, groundEmissive: 0x10183a,
    railL: 0x6af0ff, railR: 0xb070ff, line: 0x3a4a8a,
    player: 0x9ad8ff,
    block: 0x6af0ff, overhead: 0xb070ff, wall: 0xff5a8a, core: 0xeaffff,
    skyTop: 0x01020a, skyHorizon: 0x06081e, starOpacity: 1.0,
    groundOpacity: 0.35, planetOpacity: 1,
  },
];
