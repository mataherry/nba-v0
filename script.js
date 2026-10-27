// Data from ESPN's public site API. It allows cross-origin requests, so no proxy is needed.
const espnBase = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const espnAthletes = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes';
const scoresContainer = document.getElementById('scores');
const gameDetailsContainer = document.getElementById('gameDetails');

// Start on yesterday's date in WIB (GMT+7), changing at 00:00 WIB. That shows the US slate
// played this morning WIB, instead of tonight's games that haven't started yet.
// Kept as a plain calendar date at local noon so adding/subtracting days never skips over DST.
let currentDate = initialDate();

function initialDate() {
    const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).split('-').map(Number);
    return new Date(y, m - 1, d - 1, 12);
}

function toEspnDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
}

// Game dates are shown as the US (Eastern) game day, matching the scoreboard.
const gameDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const localTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const teamLink = (id, label, name) =>
    `<button class="team-link" data-team-id="${esc(id)}" data-name="${esc(name || label)}">${esc(label)}</button>`;
const playerLink = (id, name) =>
    `<button class="player-link" data-athlete-id="${esc(id)}" data-name="${esc(name)}">${esc(name)}</button>`;

function navigateDate(direction) {
    currentDate.setDate(currentDate.getDate() + direction);
    gameDetailsContainer.innerHTML = '';
    fetchScores();
}

async function fetchScores() {
    let games = [];
    let error = false;
    try {
        const data = await getJson(`${espnBase}/scoreboard?dates=${toEspnDate(currentDate)}`);
        games = data.events.map(toGame);
    } catch (err) {
        console.error('Error fetching scores:', err);
        error = true;
    }
    displayScores(games, error);
}

// Flatten an ESPN event into what the scoreboard needs.
function toGame(event) {
    const comp = event.competitions[0];
    const team = side => {
        const c = comp.competitors.find(t => t.homeAway === side);
        return { tricode: c.team.abbreviation, score: c.score, winner: c.winner === true };
    };
    return {
        id: event.id,
        state: comp.status.type.state, // 'pre' | 'in' | 'post'
        statusText: comp.status.type.shortDetail,
        start: new Date(event.date),
        awayTeam: team('away'),
        homeTeam: team('home'),
    };
}

function getGameStatusText(game) {
    if (game.state === 'pre') {
        // Scheduled: show tip-off in the viewer's own time zone.
        return localTime(game.start);
    }
    return game.statusText;
}

function displayScores(games, error) {
    const formattedDate = currentDate.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    scoresContainer.innerHTML = `
        <div class="date-navigation">
            <button id="prevDate">&lt; Prev</button>
            <h2>${formattedDate}</h2>
            <button id="nextDate">Next &gt;</button>
        </div>
        ${error
            ? '<p>Error fetching scores. Please try again later.</p>'
            : games.length === 0
            ? '<p>No games scheduled for this date.</p>'
            : `<div class="games-container">
                ${games.map(game => {
                    const final = game.state === 'post';
                    const awayWinner = final && game.awayTeam.winner;
                    const homeWinner = final && game.homeTeam.winner;
                    const showScore = game.state !== 'pre';
                    return `
                        <div class="game" data-game-id="${esc(game.id)}">
                            <div class="teams">
                                <span class="${awayWinner ? 'winner' : ''}">${esc(game.awayTeam.tricode)}</span>
                                <span class="at-symbol">@</span>
                                <span class="${homeWinner ? 'winner' : ''}">${esc(game.homeTeam.tricode)}</span>
                            </div>
                            <div class="score">
                                <span class="${awayWinner ? 'winner' : ''}">${showScore ? esc(game.awayTeam.score) : '-'}</span>
                                <span class="status">${esc(getGameStatusText(game))}</span>
                                <span class="${homeWinner ? 'winner' : ''}">${showScore ? esc(game.homeTeam.score) : '-'}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>`
        }
    `;
    // The buttons are re-rendered each time, so their handlers are re-attached here.
    document.getElementById('prevDate').addEventListener('click', () => navigateDate(-1));
    document.getElementById('nextDate').addEventListener('click', () => navigateDate(1));
}

async function handleGameClick(event) {
    const gameElement = event.target.closest('.game');
    if (gameElement) {
        await fetchGameDetails(gameElement.dataset.gameId);
    }
}

async function fetchGameDetails(gameId) {
    try {
        displayGameDetails(toBoxScore(await getJson(`${espnBase}/summary?event=${encodeURIComponent(gameId)}`)));
    } catch (error) {
        console.error('Error fetching game details:', error);
        gameDetailsContainer.innerHTML = '<p>Error fetching game details. Please try again later.</p>';
    }
    gameDetailsContainer.scrollIntoView({ behavior: 'smooth' });
}

// Convert ESPN's summary into per-team box score data.
function toBoxScore(summary) {
    const comp = summary.header.competitions[0];
    const box = summary.boxscore || {};

    const team = side => {
        const c = comp.competitors.find(t => t.homeAway === side);
        const abbr = c.team.abbreviation;
        const teamStats = (box.teams || []).find(t => t.team.abbreviation === abbr)?.statistics || [];
        const stat = name => teamStats.find(s => s.name === name)?.displayValue;

        const group = (box.players || []).find(p => p.team.abbreviation === abbr)?.statistics?.[0];
        const keys = group?.keys || [];
        // Pick the box score columns out of an ESPN stats array (players and team totals share the key order).
        const lineStats = stats => {
            const val = key => stats?.[keys.indexOf(key)] ?? '';
            return {
                threes: val('threePointFieldGoalsMade-threePointFieldGoalsAttempted').split('-')[0],
                points: val('points'),
                rebounds: val('rebounds'),
                assists: val('assists'),
                steals: val('steals'),
                blocks: val('blocks'),
                turnovers: val('turnovers'),
            };
        };
        const players = (group?.athletes || []).map(a => ({
            id: a.athlete.id,
            name: a.athlete.displayName,
            shortName: a.athlete.shortName || a.athlete.displayName,
            starter: a.starter,
            position: a.athlete.position?.abbreviation || '',
            active: !a.didNotPlay && a.stats?.length > 0,
            reason: a.didNotPlay ? a.reason : '',
            ...lineStats(a.stats),
        }));

        return {
            id: c.team.id,
            tricode: abbr,
            name: c.team.displayName,
            score: c.score ?? '-',
            winner: c.winner === true,
            // Win-loss record as of this game.
            record: (c.record || []).find(r => r.type === 'total')?.summary || '-',
            periods: (c.linescores || []).map(l => l.displayValue),
            fgPct: stat('fieldGoalPct'),
            threePct: stat('threePointFieldGoalPct'),
            ftPct: stat('freeThrowPct'),
            players,
            totals: group?.totals?.length ? lineStats(group.totals) : null,
        };
    };

    return {
        state: comp.status.type.state,
        date: comp.date,
        awayTeam: team('away'),
        homeTeam: team('home'),
    };
}

// ESPN gives percentages like "45.5"; show them as ".46" like before.
function formatPct(value) {
    if (value === undefined || value === '') return '-';
    return (Number(value) / 100).toFixed(2).replace(/^0\./, '.');
}

function periodLabel(i) {
    return i < 4 ? String(i + 1) : i === 4 ? 'OT' : `OT${i - 3}`;
}

// US (Eastern) game day, matching the scoreboard's dates.
function gameDate(game) {
    return game.date ? new Date(game.date).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
    }) : '';
}

// Only used before tip-off, when there is no stats table to show the teams.
function matchupHeader(game) {
    const { awayTeam, homeTeam } = game;
    const date = gameDate(game);
    return `<h2>${teamLink(awayTeam.id, awayTeam.tricode, awayTeam.name)} @ ${teamLink(homeTeam.id, homeTeam.tricode, homeTeam.name)}${date ? ` <span class="title-date">${esc(date)}</span>` : ''}</h2>`;
}

function displayGameDetails(game) {
    const { awayTeam, homeTeam } = game;
    if (game.state === 'pre') {
        gameDetailsContainer.innerHTML = `
            ${matchupHeader(game)}
            <p class="game-date">This game hasn't started yet. The box score will appear at tip-off.</p>`;
        return;
    }

    const isGameFinal = game.state === 'post';
    const awayWinner = isGameFinal && awayTeam.winner;
    const homeWinner = isGameFinal && homeTeam.winner;
    // At least 4 quarters, more if the game went to overtime.
    const periodCount = Math.max(4, awayTeam.periods.length, homeTeam.periods.length);
    const periodIdx = [...Array(periodCount).keys()];

    const teamRow = (team, isWinner) => `
        <tr class="${isWinner ? 'winner' : ''}">
            <td>${teamLink(team.id, team.tricode, team.name)} (${esc(team.record)})</td>
            <td>${esc(team.score)}</td>
            ${periodIdx.map(i => `<td>${esc(team.periods[i] ?? '-')}</td>`).join('')}
            <td>${formatPct(team.fgPct)}</td>
            <td>${formatPct(team.threePct)}</td>
            <td>${formatPct(team.ftPct)}</td>
        </tr>`;

    // The heading is only needed on desktop; on mobile the selected tab already names the team.
    const createTeamTable = (team, showTitle = true) => {
        const activePlayers = team.players.filter(p => p.active);
        const inactivePlayers = team.players.filter(p => !p.active);
        return `
            <div class="team-table">
                ${showTitle ? `<h3>${teamLink(team.id, team.tricode, team.name)} Players</h3>` : ''}
                <table>
                    <tr>
                        <th>Player</th>
                        <th>3s</th>
                        <th>PT</th>
                        <th>RB</th>
                        <th>AS</th>
                        <th>ST</th>
                        <th>BL</th>
                        <th>TO</th>
                    </tr>
                    ${activePlayers.map(createPlayerRow).join('')}
                    <tbody class="inactive-players" style="display: none;">
                        ${inactivePlayers.map(createInactiveRow).join('')}
                    </tbody>
                    ${team.totals ? `<tfoot>${statRow('Team Totals', team.totals, 'team-totals')}</tfoot>` : ''}
                </table>
                ${inactivePlayers.length ? `<button class="toggle-inactive">Show Inactive Players</button>` : ''}
            </div>
        `;
    };

    gameDetailsContainer.innerHTML = `
        <table>
            <tr>
                <th>Team</th>
                <th>Points</th>
                ${periodIdx.map(i => `<th>${periodLabel(i)}</th>`).join('')}
                <th>FG</th>
                <th>3P</th>
                <th>FT</th>
            </tr>
            ${teamRow(awayTeam, awayWinner)}
            ${teamRow(homeTeam, homeWinner)}
        </table>
        <div class="player-stats">
            <!-- Date on the left; team tabs (mobile only) on the same row. -->
            <div class="detail-bar">
                <span class="detail-date">${esc(gameDate(game))}</span>
                <div class="tabs">
                    <button class="tab-button active" data-team="${esc(awayTeam.tricode)}">${esc(awayTeam.tricode)}</button>
                    <button class="tab-button" data-team="${esc(homeTeam.tricode)}">${esc(homeTeam.tricode)}</button>
                </div>
            </div>
            <div class="desktop-view">
                ${createTeamTable(awayTeam)}
                ${createTeamTable(homeTeam)}
            </div>
            <div class="mobile-view">
                <div class="tab-content active" data-team="${esc(awayTeam.tricode)}">
                    ${createTeamTable(awayTeam, false)}
                </div>
                <div class="tab-content" data-team="${esc(homeTeam.tricode)}">
                    ${createTeamTable(homeTeam, false)}
                </div>
            </div>
        </div>
    `;
}

// One box score row: a label cell followed by the stat columns.
function statRow(labelHtml, s, className = '', labelStyle = '') {
    return `
        <tr class="${className}">
            <td style="${labelStyle}">${labelHtml}</td>
            <td>${esc(s.threes)}</td>
            <td>${esc(s.points)}</td>
            <td>${esc(s.rebounds)}</td>
            <td>${esc(s.assists)}</td>
            <td>${esc(s.steals)}</td>
            <td>${esc(s.blocks)}</td>
            <td>${esc(s.turnovers)}</td>
        </tr>
    `;
}

// Player name followed by their position in small grey text.
// Player name followed by their position in small grey text. Both the full and short ("S. Gilgeous-Alexander")
// names are rendered; CSS shows the short one on phones. The last word and the position are kept on one line,
// so a wrapped name never leaves the position (or half a hyphenated surname) alone on a line.
function playerLabel(player) {
    const pos = player.position ? ` <span class="position">${esc(player.position)}</span>` : '';
    const name = (text, cls) => {
        const words = text.split(' ');
        const last = words.pop();
        return `<span class="${cls}">${esc(words.join(' '))}${words.length ? ' ' : ''}<span class="nowrap">${esc(last)}${pos}</span></span>`;
    };
    return `<button class="player-link" data-athlete-id="${esc(player.id)}" data-name="${esc(player.name)}">${name(player.name, 'name-full')}${name(player.shortName, 'name-short')}</button>`;
}

function createPlayerRow(player) {
    // Starters are bold.
    return statRow(playerLabel(player), player, '', player.starter ? 'font-weight: bold;' : '');
}

function createInactiveRow(player) {
    return `
        <tr>
            <td>${playerLabel(player)}</td>
            <td colspan="7">${esc(player.reason || 'DNP')}</td>
        </tr>
    `;
}

function handleDetailClick(event) {
    const team = event.target.closest('.team-link');
    const player = event.target.closest('.player-link');
    if (team) {
        showTeamHistory(team.dataset.teamId, team.dataset.name);
    } else if (player) {
        showPlayerLog(player.dataset.athleteId, player.dataset.name);
    } else if (event.target.classList.contains('toggle-inactive')) {
        const teamTable = event.target.closest('.team-table');
        const inactivePlayersTable = teamTable.querySelector('.inactive-players');
        if (inactivePlayersTable.style.display === 'none') {
            inactivePlayersTable.style.display = 'table-row-group';
            event.target.textContent = 'Hide Inactive Players';
        } else {
            inactivePlayersTable.style.display = 'none';
            event.target.textContent = 'Show Inactive Players';
        }
    } else if (event.target.classList.contains('tab-button')) {
        const teamTricode = event.target.dataset.team;
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        event.target.classList.add('active');
        document.querySelector(`.tab-content[data-team="${teamTricode}"]`).classList.add('active');
    }
}

/* ---------- floating panel (team history / player game log) ---------- */

const panel = document.createElement('div');
panel.className = 'panel-overlay';
panel.hidden = true;
panel.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panelTitle">
        <div class="panel-header">
            <h3 id="panelTitle"></h3>
            <button class="panel-close" aria-label="Close">&times;</button>
        </div>
        <div class="panel-body"></div>
    </div>`;
document.body.appendChild(panel);
const panelTitle = panel.querySelector('#panelTitle');
const panelBody = panel.querySelector('.panel-body');
// Bumped on every open/close, so a slow response for a panel the user already left is dropped.
let panelRequest = 0;
// What the panel currently shows, so the season picker can reload it.
let panelView = null;

function openPanel(title, view) {
    panelView = view;
    panelTitle.textContent = title;
    panelBody.innerHTML = '<p class="panel-msg">Loading…</p>';
    panel.hidden = false;
    document.body.classList.add('panel-open');
    return ++panelRequest;
}

function closePanel() {
    panel.hidden = true;
    document.body.classList.remove('panel-open');
    panelRequest++;
}

function seasonPicker(options, selected) {
    return `
        <label class="season-picker">Season
            <select class="season-select">
                ${options.map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`).join('')}
            </select>
        </label>`;
}

// ESPN names seasons by the year they end in: 2027 is the 2026-27 season.
const seasonLabel = year => `${year - 1}-${String(year).slice(-2)}`;

async function showTeamHistory(teamId, name, season) {
    const req = openPanel(`${name} game history`, { type: 'team', id: teamId, name });
    try {
        const data = await getJson(`${espnBase}/teams/${encodeURIComponent(teamId)}/schedule${season ? `?season=${season}` : ''}`);
        if (req !== panelRequest) return;
        const year = data.requestedSeason?.year || Number(season);
        panelTitle.textContent = `${data.team?.displayName || name} · ${data.team?.recordSummary || ''}`;

        const games = data.events.map(e => {
            const comp = e.competitions[0];
            const us = comp.competitors.find(c => String(c.team.id) === String(teamId));
            const them = comp.competitors.find(c => c !== us);
            return {
                id: e.id,
                date: e.date,
                done: comp.status.type.completed,
                atVs: us.homeAway === 'home' ? 'vs' : '@',
                opp: them.team,
                result: us.winner ? 'W' : 'L',
                score: `${us.score?.displayValue ?? ''}-${them.score?.displayValue ?? ''}`,
                record: (us.record || []).find(r => r.type === 'total')?.displayValue || '',
            };
        });
        const played = games.filter(g => g.done).reverse();
        const upcoming = games.filter(g => !g.done).slice(0, 5);

        const row = g => `
            <tr class="panel-game" data-game-id="${esc(g.id)}">
                <td>${gameDay(g.date)}</td>
                <td>${g.atVs} ${teamLink(g.opp.id, g.opp.abbreviation, g.opp.displayName)}</td>
                ${g.done
                    ? `<td class="${g.result === 'W' ? 'win' : 'loss'}">${g.result} ${esc(g.score)}</td><td>${esc(g.record)}</td>`
                    : `<td colspan="2">${localTime(g.date)}</td>`}
            </tr>`;

        const years = [...Array(5).keys()].map(i => [year - i, seasonLabel(year - i)]);
        panelBody.innerHTML = `
            ${seasonPicker(years, year)}
            ${upcoming.length ? `
                <h4>Upcoming</h4>
                <table class="panel-table"><tr><th>Date</th><th>Opp</th><th colspan="2">Tip-off</th></tr>${upcoming.map(row).join('')}</table>` : ''}
            <h4>Results</h4>
            ${played.length
                ? `<table class="panel-table"><tr><th>Date</th><th>Opp</th><th>Result</th><th>W-L</th></tr>${played.map(row).join('')}</table>`
                : '<p class="panel-msg">No games played yet this season.</p>'}`;
    } catch (error) {
        console.error('Error fetching team history:', error);
        if (req === panelRequest) panelBody.innerHTML = '<p class="panel-msg">Error fetching team history. Please try again later.</p>';
    }
}

async function showPlayerLog(athleteId, name, season) {
    const req = openPanel(`${name}`, { type: 'player', id: athleteId, name });
    try {
        const data = await getJson(`${espnAthletes}/${encodeURIComponent(athleteId)}/gamelog${season ? `?season=${season}` : ''}`);
        if (req !== panelRequest) return;
        const idx = key => data.names.indexOf(key);
        // Same columns as the box score: 3s is threes made, taken from "made-attempted".
        const cols = [
            ['3s', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', v => v.split('-')[0]],
            ['PT', 'points'], ['RB', 'totalRebounds'], ['AS', 'assists'],
            ['ST', 'steals'], ['BL', 'blocks'], ['TO', 'turnovers'],
        ].map(([label, key, pick = v => v]) => ({ label, get: stats => pick(String(stats[idx(key)] ?? '')) }));
        const statCells = stats => cols.map(c => `<td>${esc(c.get(stats))}</td>`).join('');
        const head = `<tr><th>Date</th><th>Opp</th><th>Result</th>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr>`;

        // Average each column over the listed games. ESPN's own summary can lag a game behind.
        const averages = games => cols.map(c => {
            const nums = games.map(g => Number(c.get(g.stats))).filter(Number.isFinite);
            return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '';
        });

        // Regular season only (ESPN also sends preseason and playoffs).
        const regular = (data.seasonTypes || []).filter(st => /regular season/i.test(st.displayName || ''));
        const sections = regular.map(st => {
            // Games are grouped by month; flatten them, most recent first as ESPN sends them.
            const games = (st.categories || []).flatMap(c => c.events || []).filter(g => data.events[g.eventId]);
            const rows = games.map(({ eventId, stats }) => {
                const ev = data.events[eventId];
                const home = ev.atVs === 'vs';
                const mine = home ? ev.homeTeamScore : ev.awayTeamScore;
                const theirs = home ? ev.awayTeamScore : ev.homeTeamScore;
                return `
                    <tr class="panel-game" data-game-id="${esc(eventId)}">
                        <td>${gameDay(ev.gameDate)}</td>
                        <td>${esc(ev.atVs)} ${teamLink(ev.opponent.id, ev.opponent.abbreviation, ev.opponent.displayName)}</td>
                        <td class="${ev.gameResult === 'W' ? 'win' : 'loss'}">${esc(ev.gameResult)} ${esc(mine)}-${esc(theirs)}</td>
                        ${statCells(stats)}
                    </tr>`;
            }).join('');
            if (!games.length) return '';
            const avgCells = averages(games).map(v => `<td>${esc(v)}</td>`).join('');
            return `
                <h4>${esc(st.displayName)}</h4>
                <table class="panel-table">${head}${rows}
                    <tr class="panel-avg"><td colspan="3">Average (${games.length} games)</td>${avgCells}</tr>
                </table>`;
        }).filter(Boolean).join('');

        const seasonFilter = (data.filters || []).find(f => f.name === 'season');
        const options = (seasonFilter?.options || []).map(o => [o.value, o.displayValue]);
        panelBody.innerHTML = `
            ${options.length ? seasonPicker(options, seasonFilter.value) : ''}
            ${sections || '<p class="panel-msg">No regular season games this season.</p>'}`;
    } catch (error) {
        console.error('Error fetching game log:', error);
        if (req === panelRequest) panelBody.innerHTML = '<p class="panel-msg">Error fetching game log. Please try again later.</p>';
    }
}

panel.addEventListener('click', event => {
    if (event.target === panel || event.target.closest('.panel-close')) return closePanel();
    const team = event.target.closest('.team-link');
    if (team) return showTeamHistory(team.dataset.teamId, team.dataset.name);
    // Clicking any game row opens that game's box score.
    const game = event.target.closest('.panel-game');
    if (game) {
        closePanel();
        fetchGameDetails(game.dataset.gameId);
    }
});

panel.addEventListener('change', event => {
    if (!event.target.classList.contains('season-select') || !panelView) return;
    const show = panelView.type === 'team' ? showTeamHistory : showPlayerLog;
    show(panelView.id, panelView.name, event.target.value);
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
});

// Attach container handlers once; the old code added a new one on every render,
// which made clicks fire repeatedly (and the inactive toggle open and close itself).
scoresContainer.addEventListener('click', handleGameClick);
gameDetailsContainer.addEventListener('click', handleDetailClick);

fetchScores();
