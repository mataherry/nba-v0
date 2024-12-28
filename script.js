const proxyUrl = 'https://careful-fox-81.deno.dev/'
const scoresUrl = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const scheduleUrl = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
const scoresContainer = document.getElementById('scores');
const gameDetailsContainer = document.getElementById('gameDetails');
let currentDate = new Date();
let schedule;

async function fetchSchedule() {
    try {
        const response = await fetch(proxyUrl + scheduleUrl);
        const data = await response.json();
        schedule = data.leagueSchedule.gameDates;
    } catch (error) {
        console.error('Error fetching schedule:', error);
    }
}

function findGamesByDate(targetDate) {
    const formattedTargetDate = targetDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }) + " 00:00:00";
    return schedule.find(gameDate => gameDate.gameDate === formattedTargetDate);
}

function navigateDate(direction) {
    currentDate.setDate(currentDate.getDate() + direction);
    fetchScores();
}

async function fetchScores() {
    if (!schedule) {
        await fetchSchedule();
    }

    let scoreboard;
    const today = new Date();
    const isToday = currentDate.toDateString() === today.toDateString();

    if (isToday) {
        try {
            const response = await fetch(proxyUrl + scoresUrl);
            const data = await response.json();
            scoreboard = data.scoreboard;
        } catch (error) {
            console.error('Error fetching today\'s scores:', error);
            scoreboard = { games: [], gameDate: currentDate };
        }
    } else {
        const gameDate = findGamesByDate(currentDate);
        if (!gameDate) {
            scoreboard = { games: [], gameDate: currentDate };
        } else {
            scoreboard = { games: gameDate.games, gameDate: gameDate.gameDate };
        }
    }

    displayScores(scoreboard);
}

function displayScores(scoreboard) {
    const formattedDate = new Date(scoreboard.gameDate).toLocaleDateString('en-US', {
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
        ${scoreboard.games.length === 0 
            ? '<p>No games scheduled for this date.</p>'
            : `<div class="games-container">
                ${scoreboard.games.map(game => {
                    const awayWinner = game.gameStatus === 3 && game.awayTeam.score > game.homeTeam.score;
                    const homeWinner = game.gameStatus === 3 && game.homeTeam.score > game.awayTeam.score;
                    return `
                        <div class="game" data-game-id="${game.gameId}">
                            <div class="teams">
                                <span class="${awayWinner ? 'winner' : ''}">${game.awayTeam.teamTricode || game.awayTeam.teamTricode}</span>
                                <span class="at-symbol">@</span>
                                <span class="${homeWinner ? 'winner' : ''}">${game.homeTeam.teamTricode || game.homeTeam.teamTricode}</span>
                            </div>
                            <div class="score">
                                <span class="${awayWinner ? 'winner' : ''}">${game.awayTeam.score || '-'}</span>
                                <span class="status">${game.gameStatusText || getGameStatusText(game)}</span>
                                <span class="${homeWinner ? 'winner' : ''}">${game.homeTeam.score || '-'}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>`
        }
    `;

    document.getElementById('prevDate').addEventListener('click', () => navigateDate(-1));
    document.getElementById('nextDate').addEventListener('click', () => navigateDate(1));
    scoresContainer.addEventListener('click', handleGameClick);
}

function getGameStatusText(game) {
    const gameTime = new Date(game.gameDateTimeUTC);
    return gameTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function handleGameClick(event) {
    const gameElement = event.target.closest('.game');
    if (gameElement) {
        const gameId = gameElement.dataset.gameId;
        await fetchGameDetails(gameId);
        gameDetailsContainer.scrollIntoView({ behavior: 'smooth' });
    }
}

async function fetchGameDetails(gameId) {
    try {
        const response = await fetch(`${proxyUrl}https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`);
        const data = await response.json();
        displayGameDetails(data.game);
    } catch (error) {
        console.error('Error fetching game details:', error);
        gameDetailsContainer.innerHTML = '<p>Error fetching game details. Please try again later.</p>';
    }
}

function displayGameDetails(game) {
    const createTeamTable = (team, isWinner) => {
        const activePlayers = team.players.filter(player => player.status === 'ACTIVE');
        const inactivePlayers = team.players.filter(player => player.status !== 'ACTIVE');
        
        return `
            <div class="team-table">
                <h3>${team.teamTricode} Players</h3>
                <table>
                    <tr>
                        <th>Player</th>
                        <th>PT</th>
                        <th>RB</th>
                        <th>AS</th>
                        <th>ST</th>
                        <th>BL</th>
                        <th>TO</th>
                    </tr>
                    ${activePlayers.map(player => createPlayerRow(player, true)).join('')}
                    <tbody class="inactive-players" style="display: none;">
                        ${inactivePlayers.map(player => createPlayerRow(player, false)).join('')}
                    </tbody>
                </table>
                <button class="toggle-inactive" data-team="${team.teamTricode}">Show Inactive Players</button>
            </div>
        `;
    };

    const formattedDate = new Date(game.gameTimeLocal).toLocaleString('en-US', {
        weekday: 'short',
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York'
    });

    const isGameFinal = game.gameStatus === 3;
    const awayWinner = isGameFinal && game.awayTeam.score > game.homeTeam.score;
    const homeWinner = isGameFinal && game.homeTeam.score > game.awayTeam.score;

    gameDetailsContainer.innerHTML = `
        <h2>${game.awayTeam.teamTricode} @ ${game.homeTeam.teamTricode}</h2>
        <p class="game-date">${formattedDate} ET</p>
        <h3>Team Stats</h3>
        <table>
            <tr>
                <th>Team</th>
                <th>Points</th>
                <th>FG%</th>
                <th>3P%</th>
                <th>FT%</th>
            </tr>
            <tr class="${awayWinner ? 'winner' : ''}">
                <td>${game.awayTeam.teamTricode}</td>
                <td>${game.awayTeam.score}</td>
                <td>${game.awayTeam.statistics.fieldGoalsPercentage.toFixed(2)}</td>
                <td>${game.awayTeam.statistics.threePointersPercentage.toFixed(2)}</td>
                <td>${game.awayTeam.statistics.freeThrowsPercentage.toFixed(2)}</td>
            </tr>
            <tr class="${homeWinner ? 'winner' : ''}">
                <td>${game.homeTeam.teamTricode}</td>
                <td>${game.homeTeam.score}</td>
                <td>${game.homeTeam.statistics.fieldGoalsPercentage.toFixed(2)}</td>
                <td>${game.homeTeam.statistics.threePointersPercentage.toFixed(2)}</td>
                <td>${game.homeTeam.statistics.freeThrowsPercentage.toFixed(2)}</td>
            </tr>
        </table>
        <div class="player-stats">
            <div class="desktop-view">
                ${createTeamTable(game.awayTeam, awayWinner)}
                ${createTeamTable(game.homeTeam, homeWinner)}
            </div>
            <div class="mobile-view">
                <div class="tabs">
                    <button class="tab-button active" data-team="${game.awayTeam.teamTricode}">${game.awayTeam.teamTricode}</button>
                    <button class="tab-button" data-team="${game.homeTeam.teamTricode}">${game.homeTeam.teamTricode}</button>
                </div>
                <div class="tab-content active" data-team="${game.awayTeam.teamTricode}">
                    ${createTeamTable(game.awayTeam, awayWinner)}
                </div>
                <div class="tab-content" data-team="${game.homeTeam.teamTricode}">
                    ${createTeamTable(game.homeTeam, homeWinner)}
                </div>
            </div>
        </div>
    `;

    gameDetailsContainer.addEventListener('click', handleDetailClick);
}

function createPlayerRow(player, isActive) {
    const stats = player.statistics;
    const isStarter = player.starter === '1';
    const cellStyle = isStarter ? 'font-weight: bold;' : '';
    return `
        <tr>
            <td style="${cellStyle}">${player.name}</td>
            <td>${stats.points}</td>
            <td>${stats.reboundsTotal}</td>
            <td>${stats.assists}</td>
            <td>${stats.steals}</td>
            <td>${stats.blocks}</td>
            <td>${stats.turnovers}</td>
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

fetchSchedule().then(() => fetchScores());