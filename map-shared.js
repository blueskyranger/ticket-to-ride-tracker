// =====================================================
// MAP ENGINE — shared drawing code
// Loaded by map-3.html, map-4.html, and map-5.html
// =====================================================

// The 5 Ticket to Ride train colours
const COLOUR_OPTIONS = [
  { key: 'red',    hex: '#D32F2F', label: 'Red'    },
  { key: 'blue',   hex: '#1565C0', label: 'Blue'   },
  { key: 'green',  hex: '#2E7D32', label: 'Green'  },
  { key: 'black',  hex: '#212121', label: 'Black'  },
  { key: 'yellow', hex: '#FDD835', label: 'Yellow' },
];

// =====================================================
// CITY POSITIONS
// x/y are SVG coordinates inside a 640 × 560 viewBox.
// =====================================================
const CITIES = {
  capetown:     { x: 212, y: 525, label: 'Cape Town'      },
  cairo:        { x: 332, y:  44, label: 'Cairo'          },
  johannesburg: { x: 276, y: 448, label: 'Johannesburg'   },
  maputo:       { x: 336, y: 482, label: 'Maputo'         },
  harare:       { x: 320, y: 385, label: 'Harare'         },
  lusaka:       { x: 278, y: 325, label: 'Lusaka'         },
  luanda:       { x: 175, y: 327, label: 'Luanda'         },
  kinshasa:     { x: 218, y: 287, label: 'Kinshasa'       },
  brazzaville:  { x: 232, y: 270, label: 'Brazzaville'    },
  daresSalaam:  { x: 392, y: 297, label: 'Dar es Salaam'  },
  mombasa:      { x: 413, y: 256, label: 'Mombasa'        },
  nairobi:      { x: 376, y: 226, label: 'Nairobi'        },
  addisAbaba:   { x: 407, y: 160, label: 'Addis Ababa'    },
  khartoum:     { x: 350, y: 106, label: 'Khartoum'       },
  kampala:      { x: 350, y: 198, label: 'Kampala'        },
  lagos:        { x: 146, y: 226, label: 'Lagos'          },
  accra:        { x: 110, y: 208, label: 'Accra'          },
  dakar:        { x:  64, y: 158, label: 'Dakar'          },
  casablanca:   { x: 110, y:  86, label: 'Casablanca'     },
  tripoli:      { x: 220, y:  74, label: 'Tripoli'        },
  aswan:        { x: 350, y:  74, label: 'Aswan'          },
  kigali:       { x: 320, y: 266, label: 'Kigali'         },
  ndjamena:     { x: 233, y: 193, label: "N'Djamena"      },
  juba:         { x: 350, y: 160, label: 'Juba'           },
  antananarivo: { x: 430, y: 445, label: 'Antananarivo'   },
  windhoek:     { x: 175, y: 450, label: 'Windhoek'       },
};

// All valid track connections between city pairs
const CONNECTIONS = [
  ['capetown','johannesburg'], ['capetown','maputo'],     ['capetown','windhoek'],
  ['windhoek','luanda'],       ['johannesburg','maputo'], ['johannesburg','harare'],
  ['maputo','harare'],         ['maputo','antananarivo'], ['harare','lusaka'],
  ['harare','daresSalaam'],    ['harare','kigali'],       ['lusaka','kinshasa'],
  ['lusaka','daresSalaam'],    ['lusaka','luanda'],       ['luanda','kinshasa'],
  ['kinshasa','brazzaville'],  ['brazzaville','ndjamena'],['kinshasa','lagos'],
  ['daresSalaam','mombasa'],   ['daresSalaam','nairobi'], ['kigali','nairobi'],
  ['kigali','kampala'],        ['mombasa','nairobi'],     ['nairobi','kampala'],
  ['nairobi','addisAbaba'],    ['kampala','juba'],        ['juba','addisAbaba'],
  ['juba','khartoum'],         ['addisAbaba','khartoum'], ['khartoum','aswan'],
  ['aswan','cairo'],           ['khartoum','cairo'],      ['lagos','accra'],
  ['accra','dakar'],           ['dakar','casablanca'],    ['casablanca','tripoli'],
  ['tripoli','cairo'],         ['ndjamena','tripoli'],    ['ndjamena','khartoum'],
  ['tripoli','aswan'],
];

// Pool of routes from Cape Town to Cairo.
// Routes are randomly assigned to players each page load so every game looks different.
const ROUTE_POOL = [
  ['capetown','johannesburg','harare','kigali','nairobi','addisAbaba','khartoum','cairo'],
  ['capetown','maputo','harare','daresSalaam','mombasa','nairobi','kampala','juba','khartoum','aswan','cairo'],
  ['capetown','johannesburg','lusaka','kinshasa','lagos','accra','dakar','casablanca','tripoli','cairo'],
  ['capetown','luanda','kinshasa','brazzaville','ndjamena','tripoli','cairo'],
  ['capetown','windhoek','luanda','kinshasa','lagos','accra','dakar','casablanca','tripoli','aswan','cairo'],
  ['capetown','johannesburg','harare','lusaka','kinshasa','ndjamena','khartoum','cairo'],
  ['capetown','maputo','harare','kigali','kampala','addisAbaba','khartoum','aswan','cairo'],
];

// Per-player pixel offsets so trains don't stack when they're near each other
const OFFSETS_3 = [[-8, -4], [ 4, -8], [ 8,  4]];
const OFFSETS_4 = [[-8, -4], [ 4, -8], [ 8,  4], [-4,  8]];
const OFFSETS_5 = [[-8, -4], [ 4, -8], [ 8,  4], [-4,  8], [ 0, -10]];

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

// Randomly picks n unique routes from the pool so no two players share the same path
function pickRoutes(n) {
  const shuffled = [...ROUTE_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Creates an SVG element with the given attributes and appends it to a parent element
const SVG_NS = 'http://www.w3.org/2000/svg';
function mk(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

// Converts a player name to two initials — "Kevin Smith" → "KS", "James" → "JA"
function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// =====================================================
// MAP DRAWING FUNCTIONS
// =====================================================

// Returns the {x, y} SVG coordinate for a train that is pct (0–1) of the way along its route
function getTrainPos(route, pct) {
  const segs = route.length - 1;
  const d    = Math.min(pct * segs, segs - 0.01);
  const si   = Math.floor(d);
  const sp   = d - si;
  const ca   = CITIES[route[si]];
  const cb   = CITIES[route[si + 1]];
  return {
    x: ca.x + (cb.x - ca.x) * sp,
    y: ca.y + (cb.y - ca.y) * sp,
  };
}

// Draws the completed portion of a player's route.
// The coloured line stops exactly at the current train position.
function drawTrack(svg, route, pct, colour) {
  const segs = route.length - 1;
  route.forEach((cityId, i) => {
    if (i === 0) return; // no segment before the start city
    const segStart = (i - 1) / segs;
    const segEnd   = i / segs;
    if (pct < segStart) return; // player hasn't reached this segment yet
    // how far along this segment the player has progressed
    const linePct = pct >= segEnd ? 1 : (pct - segStart) / (segEnd - segStart);
    const ca = CITIES[route[i - 1]];
    const cb = CITIES[cityId];
    mk('line', {
      x1: ca.x, y1: ca.y,
      x2: ca.x + (cb.x - ca.x) * linePct,
      y2: ca.y + (cb.y - ca.y) * linePct,
      stroke: colour, 'stroke-width': '3',
      opacity: '0.6', 'stroke-linecap': 'round',
    }, svg);
  });
}

// Draws a detailed locomotive icon at (cx + ox, cy + oy).
// Returns the score bubble <text> element so the caller can set its content.
function drawTrain(svg, cx, cy, colour, playerInitials, ox, oy) {
  const g = mk('g', { transform: `translate(${cx + ox},${cy + oy})` }, svg);

  // Smoke puffs above the funnel
  mk('ellipse', { cx: '1',  cy: '-27', rx: '5', ry: '4', fill: colour, opacity: '0.22' }, g);
  mk('ellipse', { cx: '3',  cy: '-33', rx: '3', ry: '3', fill: colour, opacity: '0.14' }, g);

  // Boiler dome
  mk('circle', { cx: '9', cy: '-22', r: '6', fill: colour, opacity: '0.9' }, g);
  mk('circle', { cx: '9', cy: '-22', r: '3', fill: 'rgba(255,255,255,0.18)' }, g);

  // Cab body and roof
  mk('rect', { x: '-10', y: '-24', width: '22', height: '9',  rx: '2.5', fill: colour }, g);
  mk('rect', { x: '-8',  y: '-31', width: '15', height: '9',  rx: '2',   fill: colour }, g);

  // Cab windows
  mk('rect', { x: '-7', y: '-30', width: '5', height: '5', rx: '1', fill: 'rgba(255,255,255,0.35)' }, g);
  mk('rect', { x: '1',  y: '-30', width: '5', height: '5', rx: '1', fill: 'rgba(255,255,255,0.35)' }, g);

  // Cowcatcher / front plate
  mk('rect', { x: '-12', y: '-15', width: '3', height: '8', rx: '1', fill: colour }, g);

  // Undercarriage shadow
  mk('rect', { x: '-10', y: '-9', width: '22', height: '4', rx: '1', fill: 'rgba(0,0,0,0.18)' }, g);

  // Drive wheels
  mk('circle', { cx: '-4', cy: '-5', r: '5', fill: '#2a2010', stroke: '#7a6040', 'stroke-width': '1.2' }, g);
  mk('circle', { cx: '-4', cy: '-5', r: '2', fill: '#4a3820' }, g);
  mk('circle', { cx: '7',  cy: '-5', r: '5', fill: '#2a2010', stroke: '#7a6040', 'stroke-width': '1.2' }, g);
  mk('circle', { cx: '7',  cy: '-5', r: '2', fill: '#4a3820' }, g);

  // Player initials on the cab side
  mk('text', {
    x: '1', y: '-16', 'text-anchor': 'middle',
    fill: '#fff', 'font-size': '5.5',
    'font-family': 'sans-serif', 'font-weight': 'bold',
  }, g).textContent = playerInitials;

  // Score bubble floating above the train
  const bubble = mk('g', { transform: 'translate(-26,-44)' }, g);
  mk('rect', {
    x: '0', y: '-9', width: '30', height: '12', rx: '3',
    fill: '#ffffffdd', stroke: colour, 'stroke-width': '1.2',
  }, bubble);
  const lbl = mk('text', {
    x: '15', y: '-1', 'text-anchor': 'middle',
    fill: colour, 'font-size': '7',
    'font-family': 'sans-serif', 'font-weight': 'bold',
  }, bubble);
  return lbl; // caller sets lbl.textContent = score string
}

// Draws all city nodes. Terminus cities (Cape Town, Cairo) get a larger double-ring.
function drawCities(svg, bgColour, strokeColour, termColour) {
  Object.entries(CITIES).forEach(([id, c]) => {
    const isTerm = id === 'capetown' || id === 'cairo';

    mk('circle', {
      cx: c.x, cy: c.y,
      r: isTerm ? 10 : 5,
      fill: bgColour,
      stroke: isTerm ? termColour : strokeColour,
      'stroke-width': isTerm ? 2 : 1.2,
    }, svg);

    if (isTerm) {
      mk('circle', { cx: c.x, cy: c.y, r: '5', fill: termColour }, svg);
      mk('circle', { cx: c.x, cy: c.y, r: '2', fill: bgColour   }, svg);
    } else {
      mk('circle', { cx: c.x, cy: c.y, r: '2', fill: strokeColour }, svg);
    }

    // Label positions — shifted for cities on the right edge, below for termini
    const ax = c.x > 420 ? 'start' : c.x < 90 ? 'start' : 'middle';
    const dx = c.x > 420 ? 13 : c.x < 90 ? -13 : 0;
    const dy = id === 'capetown' ? 22 : id === 'cairo' ? -15 : c.y > 460 ? 18 : -9;
    mk('text', {
      x: c.x + dx, y: c.y + dy,
      'text-anchor': ax,
      fill: termColour,
      'font-size': '8', 'font-family': 'sans-serif', 'letter-spacing': '0.3',
    }, svg).textContent = c.label;
  });
}

// Draws the dashed background network showing all possible track connections
function drawConnections(svg, strokeColour) {
  CONNECTIONS.forEach(([a, b]) => {
    const ca = CITIES[a];
    const cb = CITIES[b];
    if (!ca || !cb) return;
    mk('line', {
      x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y,
      stroke: strokeColour,
      'stroke-width': '1.2',
      'stroke-dasharray': '4 3',
      'stroke-linecap': 'round',
    }, svg);
  });
}

// =====================================================
// MAIN MAP RENDER FUNCTION
//
// svgId       — id of the <svg> element to draw into
// stripId     — id of the score-strip <div>
// players     — array of { name, pts, colour } objects
// routes      — pre-generated route array (one route per player)
// goal        — season target score (e.g. 1000)
// mapBg       — background fill colour for the map canvas
// trackColour — colour of the dashed background track network
// cityStroke  — dot colour for non-terminus cities
// termColour  — ring/label colour for Cape Town and Cairo
// offsets     — per-player [ox, oy] to spread trains apart
// =====================================================
function drawMap(svgId, stripId, players, routes, goal, mapBg, trackColour, cityStroke, termColour, offsets) {
  const svg   = document.getElementById(svgId);
  const strip = document.getElementById(stripId);
  svg.innerHTML   = '';
  strip.innerHTML = '';

  // Map background rectangle
  mk('rect', { x: 0, y: 0, width: 640, height: 560, fill: mapBg }, svg);

  // Faint grid lines for a cartographic feel
  for (let i = 0; i <= 640; i += 20) {
    mk('line', { x1: i, y1: 0, x2: i, y2: 560, stroke: cityStroke, 'stroke-width': '0.3', opacity: '0.4' }, svg);
  }
  for (let j = 0; j <= 560; j += 20) {
    mk('line', { x1: 0, y1: j, x2: 640, y2: j, stroke: cityStroke, 'stroke-width': '0.3', opacity: '0.4' }, svg);
  }

  drawConnections(svg, trackColour);

  // Completed track segments are drawn first so trains render on top
  players.forEach((p, pi) => {
    const pct = Math.min(p.pts / goal, 1);
    drawTrack(svg, routes[pi], pct, p.colour);
  });

  // City nodes go on top of track lines
  drawCities(svg, mapBg, cityStroke, termColour);

  // Trains go on top of everything
  players.forEach((p, pi) => {
    const pct      = Math.min(p.pts / goal, 1);
    const pos      = getTrainPos(routes[pi], pct);
    const [ox, oy] = offsets[pi] || [0, 0];
    const lbl      = drawTrain(svg, pos.x, pos.y, p.colour, getInitials(p.name), ox, oy);
    lbl.textContent = p.pts + ' pts';
  });

  // START / FINISH labels at the termini
  mk('text', {
    x: CITIES.capetown.x, y: CITIES.capetown.y + 36,
    'text-anchor': 'middle', fill: termColour,
    'font-size': '9', 'font-family': 'sans-serif',
    'letter-spacing': '1', 'font-style': 'italic',
  }, svg).textContent = 'START';

  mk('text', {
    x: CITIES.cairo.x, y: CITIES.cairo.y - 20,
    'text-anchor': 'middle', fill: termColour,
    'font-size': '9', 'font-family': 'sans-serif',
    'letter-spacing': '1', 'font-style': 'italic',
  }, svg).textContent = 'FINISH';

  // Build the score strip below the map
  players.forEach((p) => {
    const pct  = Math.min(p.pts / goal, 1);
    const cell = document.createElement('div');
    cell.className = 'score-cell';
    cell.innerHTML = `
      <span class="sc-name" style="color:${p.colour}">${p.name}</span>
      <span class="sc-pts"  style="color:${p.colour}">${p.pts}<span style="font-size:9px"> / ${goal}</span></span>
      <span class="sc-goal">${Math.round(pct * 100)}% to Cairo</span>
    `;
    strip.appendChild(cell);
  });
}
