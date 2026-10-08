// # pared | . suelo | S inicio | P interruptor | D puerta | E salida | C cristal
export const LEVELS = [
  {
    name: 'El primer pacto',
    hint: 'Cada interruptor abre la puerta del otro. Buscad la salida los dos.',
    maps: {
      sol: [
        '#########',
        '#S...D.E#',
        '###.#####',
        '#..P....#',
        '#.......#',
        '#.......#',
        '#########',
      ],
      luna: [
        '#########',
        '#E.D...S#',
        '#####.###',
        '#....P..#',
        '#.......#',
        '#.......#',
        '#########',
      ],
    },
  },
  {
    name: 'El desvío',
    hint: 'Encontrad vuestro cristal, pisad vuestro interruptor y cruzad las puertas.',
    maps: {
      sol: [
        '#############',
        '#S.C..#.....#',
        '###.#.#.###.#',
        '#...#...#...#',
        '#.#####.#.#.#',
        '#...P...#.#.#',
        '###.#########',
        '#.......D.E.#',
        '#############',
      ],
      luna: [
        '#############',
        '#.....#..C.S#',
        '#.###.#.#.###',
        '#...#...#...#',
        '#.#.#####.#.#',
        '#.#...P...#.#',
        '#########.###',
        '#.E.D.......#',
        '#############',
      ],
    },
  },
  {
    name: 'Dos caminos, un destino',
    hint: 'Hay caminos sin salida: hablad para no olvidar el cristal y el interruptor.',
    maps: {
      sol: [
        '#############',
        '#S...#......#',
        '#.#.##.###..#',
        '#.#..C...#..#',
        '#.######.#..#',
        '#....P...#..#',
        '###.#########',
        '#.......D.E.#',
        '#############',
      ],
      luna: [
        '#############',
        '#......#...S#',
        '#..###.##.#.#',
        '#..#...C..#.#',
        '#..#.######.#',
        '#..#...P....#',
        '#########.###',
        '#.E.D.......#',
        '#############',
      ],
    },
  },
];

export const ROLES = ['sol', 'luna'];

export function locate(map, symbol) {
  for (let y = 0; y < map.length; y++) {
    const x = map[y].indexOf(symbol);
    if (x >= 0) return { x, y };
  }
  return null;
}

export function newLevelState(levelIndex) {
  const level = LEVELS[levelIndex];
  return {
    positions: Object.fromEntries(ROLES.map(role => [role, locate(level.maps[role], 'S')])),
    gates: { sol: false, luna: false },
    crystals: { sol: false, luna: false },
  };
}
