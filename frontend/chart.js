const colors = { blue: '#3974e6', orange: '#c7865b', teal: '#6aa99c' };

function smoothPath(points) {
  if (points.length < 2) return '';
  const slopes = points.slice(1).map((point, i) => (point.y - points[i].y) / (point.x - points[i].x));
  const tangents = [slopes[0]];
  for (let i = 1; i < points.length - 1; i++) {
    tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]));
  }
  tangents.push(slopes.at(-1));
  return points.slice(1).reduce((path, end, i) => {
    const start = points[i];
    const dx = (end.x - start.x) / 3;
    return `${path} C ${start.x + dx},${start.y + tangents[i] * dx} ${end.x - dx},${end.y - tangents[i + 1] * dx} ${end.x},${end.y}`;
  }, `M ${points[0].x},${points[0].y}`);
}

export function renderChart({ history, roundStart, summaries, selectedHorizon, horizons }) {
  const width = 840;
  const height = 380;
  const left = 66;
  const right = 805;
  const top = 36;
  const bottom = 299;
  const day = 86400000;
  const firstTime = history[0].time;
  const lastTime = roundStart + 7 * day;
  const values = [...history.map(point => point.views), ...horizons.map(horizon => summaries[horizon.id].average)];
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const step = Math.max(1000, Math.ceil((highest - lowest || highest / 3) / 4000) * 1000);
  const min = Math.max(0, Math.floor(lowest / step - 1) * step);
  const max = Math.ceil(highest / step + 1) * step;
  const x = time => left + (time - firstTime) / (lastTime - firstTime) * (right - left);
  const y = views => bottom - (views - min) / (max - min) * (bottom - top);
  const historyPoints = history.map(point => ({ x: x(point.time), y: y(point.views) }));
  const futurePoints = horizons.map(horizon => ({ x: x(roundStart + horizon.endHours * 3600000), y: y(summaries[horizon.id].average), horizon }));
  const compactFuture = futurePoints[1].x - futurePoints[0].x < 60;
  const last = historyPoints.at(-1);
  const averagePath = [last, ...futurePoints].map(point => `${point.x},${point.y}`).join(' ');
  const date = time => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }).format(time);
  const numeric = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
  const compact = value => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const grids = Array.from({ length: 5 }, (_, i) => {
    const value = min + (max - min) * i / 4;
    return `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="chart-grid"/><text x="${left - 13}" y="${y(value) + 4}" text-anchor="end" class="chart-axis">${compact(value)}</text>`;
  }).join('');
  const pastDates = [history[0], history[Math.floor((history.length - 1) / 2)]];
  const dateLabels = pastDates.map(point => `<text x="${x(point.time)}" y="${bottom + 27}" text-anchor="middle" class="chart-axis">${date(point.time)}</text>`).join('');
  return `<svg class="views-chart" viewBox="0 0 ${width} ${height}" role="group" aria-labelledby="views-chart-title views-chart-desc">
    <title id="views-chart-title">Daily video views and crowd predictions</title>
    <desc id="views-chart-desc">The solid line shows sample historical views over trailing 24-hour windows. Dashed points show average guesses for the first, second, and seventh days. Select a point to choose a prediction window.</desc>
    <rect x="${x(roundStart)}" y="${top}" width="${right - x(roundStart)}" height="${bottom - top}" rx="3" class="chart-future"/>
    ${grids}
    <line x1="${x(roundStart)}" x2="${x(roundStart)}" y1="${top}" y2="${bottom}" class="chart-now-line"/>
    <text x="${x(roundStart) + 12}" y="${top - 13}" class="chart-axis">Crowd predictions</text>
    <path d="${smoothPath(historyPoints)}" fill="none" stroke="${colors.blue}" stroke-width="3" stroke-linecap="round"/>
    <polyline points="${averagePath}" fill="none" stroke="${colors.blue}" stroke-opacity=".7" stroke-width="2.2" stroke-dasharray="6 6"/>
    <circle cx="${last.x}" cy="${last.y}" r="4" fill="${colors.blue}"/>
    ${futurePoints.map(point => {
      const selected = point.horizon.id === selectedHorizon;
      const average = summaries[point.horizon.id].average;
      const labelOffset = compactFuture && point.horizon.id === '48h' ? 28 : compactFuture && point.horizon.id === '24h' ? -32 : -22;
      const tickOffset = compactFuture && point.horizon.id === '48h' ? 44 : 27;
      return `<g role="button" tabindex="0" data-action="select-horizon" data-horizon="${point.horizon.id}" aria-label="${point.horizon.label}, average guess ${numeric(average)} views" class="chart-point ${selected ? 'selected' : ''}">
        <title>${point.horizon.label} · Average ${numeric(average)} views · ${summaries[point.horizon.id].spotCount} spots</title>
        <circle cx="${point.x}" cy="${point.y}" r="17" fill="transparent"/>
        ${selected ? `<circle cx="${point.x}" cy="${point.y}" r="13" fill="${colors.blue}" fill-opacity=".12"/>` : ''}
        <circle cx="${point.x}" cy="${point.y}" r="${selected ? 6 : 4.8}" fill="var(--surface)" stroke="${colors.blue}" stroke-width="2.5"/>
      </g>
      <text x="${point.x}" y="${point.y + labelOffset}" text-anchor="${point.horizon.id === 'week' ? 'end' : 'middle'}" class="chart-value">${average >= 1000000 ? compact(average) : numeric(average)}</text>
      <text x="${point.x}" y="${bottom + tickOffset}" text-anchor="${point.horizon.id === 'week' ? 'end' : 'middle'}" class="chart-axis ${selected ? 'selected' : ''}">${point.horizon.label}</text>`;
    }).join('')}
    ${dateLabels}
    <text x="${x(roundStart)}" y="${bottom + (compactFuture ? 68 : 49)}" text-anchor="middle" class="chart-axis">Round start</text>
  </svg>`;
}

export function renderRewardCurve() {
  const width = 650;
  const height = 238;
  const x = rank => 45 + (rank - 1) / 99 * 580;
  const y = percent => 197 - percent * 1.55;
  const functions = [
    { fn: rank => 101 - rank, color: colors.orange, dash: '6 5' },
    { fn: rank => 100 * .5 ** (rank - 1), color: colors.teal, dash: '3 4' },
    { fn: rank => {
      const weight = .4 - .2 * (rank - 1) / 99;
      return weight * (101 - rank) + (1 - weight) * 100 * .5 ** (rank - 1);
    }, color: colors.blue, dash: '' },
  ];
  return `<svg class="mini-curve" viewBox="0 0 ${width} ${height}" role="img" aria-label="100-rank curve. Blue combined curve, orange linear, and green exponential.">
    ${[0, 50, 100].map(value => `<line x1="45" x2="625" y1="${y(value)}" y2="${y(value)}" class="chart-grid"/><text x="35" y="${y(value) + 4}" text-anchor="end" class="chart-axis">${value}%</text>`).join('')}
    ${functions.map(item => `<polyline fill="none" stroke="${item.color}" stroke-width="${item.dash ? 1.8 : 2.5}" stroke-dasharray="${item.dash}" points="${Array.from({ length: 990 }, (_, i) => { const rank = 1 + i / 989 * 99; return `${x(rank)},${y(item.fn(rank))}`; }).join(' ')}"/>`).join('')}
    ${[1, 25, 50, 75, 100].map(rank => `<text x="${x(rank)}" y="220" text-anchor="middle" class="chart-axis">${rank}</text>`).join('')}
  </svg>`;
}
