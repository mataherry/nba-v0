// Data from ESPN's public site API. It allows cross-origin requests, so no proxy is needed.
const espnBase = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const scoresContainer = document.getElementById('scores');
const gameDetailsContainer = document.getElementById('gameDetails');

// NBA game days follow US Eastern time, so "today" starts from the current ET date.
// Kept as a plain calendar date at local noon so adding/subtracting days never skips over DST.
let currentDate = etToday();

function etToday() {
    const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number);
    return new Date(y, m - 1, d, 12);
}

function toEspnDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function navigateDate(direction) {
    currentDate.setDate(currentDate.getDate() + direction);
    gameDetailsContainer.innerHTML = '';
    fetchScores();
}

async function fetchScores() {
    let games = [];
    let error = false;
    try {
        const response = await fetch(`${espnBase}/scoreboard?dates=${toEspnDate(currentDate)}`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
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
        return game.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
        gameDetailsContainer.scrollIntoView({ behavior: 'smooth' });
    }
}

async function fetchGameDetails(gameId) {
    try {
        const response = await fetch(`${espnBase}/summary?event=${encodeURIComponent(gameId)}`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        displayGameDetails(toBoxScore(await response.json()));
    } catch (error) {
        console.error('Error fetching game details:', error);
        gameDetailsContainer.innerHTML = '<p>Error fetching game details. Please try again later.</p>';
    }
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
        const players = (group?.athletes || []).map(a => {
            const val = key => a.stats?.[keys.indexOf(key)] ?? '';
            return {
                name: a.athlete.displayName,
                starter: a.starter,
                active: !a.didNotPlay && a.stats?.length > 0,
                reason: a.didNotPlay ? a.reason : '',
                threes: val('threePointFieldGoalsMade-threePointFieldGoalsAttempted').split('-')[0],
                points: val('points'),
                rebounds: val('rebounds'),
                assists: val('assists'),
                steals: val('steals'),
                blocks: val('blocks'),
                turnovers: val('turnovers'),
            };
        });

        return {
            tricode: abbr,
            score: c.score ?? '-',
            winner: c.winner === true,
            periods: (c.linescores || []).map(l => l.displayValue),
            fgPct: stat('fieldGoalPct'),
            threePct: stat('threePointFieldGoalPct'),
            ftPct: stat('freeThrowPct'),
            players,
        };
    };

    return {
        state: comp.status.type.state,
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

function displayGameDetails(game) {
    const { awayTeam, homeTeam } = game;
    if (game.state === 'pre') {
        gameDetailsContainer.innerHTML = `
            <h2>${esc(awayTeam.tricode)} @ ${esc(homeTeam.tricode)}</h2>
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
            <td>${esc(team.tricode)}</td>
            <td>${esc(team.score)}</td>
            ${periodIdx.map(i => `<td>${esc(team.periods[i] ?? '-')}</td>`).join('')}
            <td>${formatPct(team.fgPct)}</td>
            <td>${formatPct(team.threePct)}</td>
            <td>${formatPct(team.ftPct)}</td>
        </tr>`;

    const createTeamTable = team => {
        const activePlayers = team.players.filter(p => p.active);
        const inactivePlayers = team.players.filter(p => !p.active);
        return `
            <div class="team-table">
                <h3>${esc(team.tricode)} Players</h3>
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
                </table>
                ${inactivePlayers.length ? `<button class="toggle-inactive">Show Inactive Players</button>` : ''}
            </div>
        `;
    };

    gameDetailsContainer.innerHTML = `
        <h2>${esc(awayTeam.tricode)} @ ${esc(homeTeam.tricode)}</h2>
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
            <div class="desktop-view">
                ${createTeamTable(awayTeam)}
                ${createTeamTable(homeTeam)}
            </div>
            <div class="mobile-view">
                <div class="tabs">
                    <button class="tab-button active" data-team="${esc(awayTeam.tricode)}">${esc(awayTeam.tricode)}</button>
                    <button class="tab-button" data-team="${esc(homeTeam.tricode)}">${esc(homeTeam.tricode)}</button>
                </div>
                <div class="tab-content active" data-team="${esc(awayTeam.tricode)}">
                    ${createTeamTable(awayTeam)}
                </div>
                <div class="tab-content" data-team="${esc(homeTeam.tricode)}">
                    ${createTeamTable(homeTeam)}
                </div>
            </div>
        </div>
    `;
}

function createPlayerRow(player) {
    const cellStyle = player.starter ? 'font-weight: bold;' : '';
    return `
        <tr>
            <td style="${cellStyle}">${esc(player.name)}</td>
            <td>${esc(player.threes)}</td>
            <td>${esc(player.points)}</td>
            <td>${esc(player.rebounds)}</td>
            <td>${esc(player.assists)}</td>
            <td>${esc(player.steals)}</td>
            <td>${esc(player.blocks)}</td>
            <td>${esc(player.turnovers)}</td>
        </tr>
    `;
}

function createInactiveRow(player) {
    return `
        <tr>
            <td>${esc(player.name)}</td>
            <td colspan="7">${esc(player.reason || 'DNP')}</td>
        </tr>
    `;
}

function handleDetailClick(event) {
    if (event.target.classList.contains('toggle-inactive')) {
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

// Attach container handlers once; the old code added a new one on every render,
// which made clicks fire repeatedly (and the inactive toggle open and close itself).
scoresContainer.addEventListener('click', handleGameClick);
gameDetailsContainer.addEventListener('click', handleDetailClick);

fetchScores();
