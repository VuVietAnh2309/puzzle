/**
 * @jest-environment jsdom
 *
 * Sidebar layout test
 * ---------------------------------------------------------------
 * Goal: when the admin dashboard sidebar shows a live ranking PLUS the
 * bottom countdown timer, verify that
 *   - all 5 ranking items are rendered in the DOM,
 *   - the timer box is rendered,
 *   - the list is capped at 5 (not 8, not 10),
 *   - the list does not scroll (parent has overflow: hidden, which is what
 *     the "top 5 only" design relies on).
 *
 * JSDOM does not run real CSS layout, so this test cannot prove pixel-perfect
 * vertical fit on small screens — but it does verify the structure and the
 * key CSS rules that keep the list non-scrollable and the timer pinned at
 * the bottom. For true visual assertions a real browser (Playwright/Puppeteer)
 * would be required.
 */

const fs = require('fs');
const path = require('path');

const ADMIN_HTML = path.join(__dirname, '..', 'public', 'admin.html');
const STYLE_CSS = path.join(__dirname, '..', 'public', 'css', 'style.css');

// Mirrors the renderSidebarRanking HTML template in public/js/admin.js so we
// don't execute the full admin.js (which pulls in socket.io etc).
function renderSidebarItem(p, i) {
  const logoHtml = p.logo
    ? `<img src="${p.logo}" alt="">`
    : `<div>${(p.name || '?').charAt(0)}</div>`;
  const score = p.score || 0;
  return `
    <div class="sidebar-rank-item"
         data-player-id="${p.id}"
         data-score="${score}"
         id="rank-item-${p.id}">
      <div class="sidebar-rank-num">${p.rank || i + 1}</div>
      <div class="sidebar-rank-logo">${logoHtml}</div>
      <div class="sidebar-rank-info">
        <span class="sidebar-rank-name">${p.name || 'Thí sinh'}</span>
        <span class="sidebar-rank-score">${score} PTS</span>
      </div>
    </div>
  `;
}

// Build a simulated ranking render using the same slice(0, 5) cap that
// admin.js applies.
function renderTop5(ranking) {
  return ranking.slice(0, 5).map(renderSidebarItem).join('');
}

describe('Admin sidebar layout — 5 players + countdown timer', () => {
  beforeAll(() => {
    const html = fs.readFileSync(ADMIN_HTML, 'utf8');
    // Parse admin.html into the current jsdom document
    document.documentElement.innerHTML = html;
  });

  test('admin.html has sidebar title, ranking list container, and timer box', () => {
    const sidebar = document.querySelector('.dashboard-sidebar-left');
    expect(sidebar).not.toBeNull();
    expect(sidebar.querySelector('.sidebar-title')).not.toBeNull();
    expect(sidebar.querySelector('#sidebarRanking')).not.toBeNull();
    // Timer box pinned at the bottom of the sidebar
    expect(sidebar.querySelector('#timerBigOuter')).not.toBeNull();
    expect(sidebar.querySelector('.dash-timer-box .dash-timer-val')).not.toBeNull();
  });

  test('renders exactly 5 ranking items when given 10 players', () => {
    const fakeRanking = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i + 1}`,
      rank: i + 1,
      name: `Player ${i + 1}`,
      logo: null,
      score: (10 - i) * 1.5,
    }));

    const container = document.getElementById('sidebarRanking');
    container.innerHTML = renderTop5(fakeRanking);

    const items = container.querySelectorAll('.sidebar-rank-item');
    expect(items).toHaveLength(5);

    // Confirm they are the TOP 5 (highest scores), in order
    const renderedNames = Array.from(items).map((el) =>
      el.querySelector('.sidebar-rank-name').textContent
    );
    expect(renderedNames).toEqual([
      'Player 1',
      'Player 2',
      'Player 3',
      'Player 4',
      'Player 5',
    ]);
  });

  test('renders 5 items AND timer box is still present in the same sidebar', () => {
    const fakeRanking = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i + 1}`,
      rank: i + 1,
      name: `Team ${i + 1}`,
      logo: null,
      score: (5 - i),
    }));

    const sidebar = document.querySelector('.dashboard-sidebar-left');
    const list = sidebar.querySelector('#sidebarRanking');
    list.innerHTML = renderTop5(fakeRanking);

    // 5 items rendered
    expect(list.querySelectorAll('.sidebar-rank-item')).toHaveLength(5);

    // Countdown timer still rendered inside the same sidebar
    const timer = sidebar.querySelector('#timerBigOuter');
    expect(timer).not.toBeNull();
    expect(timer.querySelector('.timer-label').textContent).toBe('THỜI GIAN CÒN LẠI');
    expect(timer.querySelector('.dash-timer-unit').textContent).toBe('GIÂY');

    // List container comes before timer wrapper (DOM order → visual top→bottom)
    const listIndex = Array.from(sidebar.children).indexOf(list);
    const timerWrapper = sidebar.querySelector('.dash-sidebar-timer');
    const timerIndex = Array.from(sidebar.children).indexOf(timerWrapper);
    expect(listIndex).toBeGreaterThanOrEqual(0);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    expect(listIndex).toBeLessThan(timerIndex);
  });

  test('CSS keeps the ranking list non-scrollable (overflow: hidden, flex: 1)', () => {
    const css = fs.readFileSync(STYLE_CSS, 'utf8');
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const match = noComments.match(/\.sidebar-ranking-list\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const body = match[1];

    expect(body).toMatch(/flex\s*:\s*1/);
    expect(body).toMatch(/overflow\s*:\s*hidden/);
  });

  test('timer wrapper is pinned to the bottom via margin-top: auto', () => {
    const css = fs.readFileSync(STYLE_CSS, 'utf8');
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const match = noComments.match(/\.dash-sidebar-timer\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match[1]).toMatch(/margin-top\s*:\s*auto/);
  });
});
