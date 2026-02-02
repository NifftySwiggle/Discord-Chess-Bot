const fs = require('fs').promises;
const path = require('path');
const { startGame, makeMove, offerDraw, acceptDraw, declineDraw, surrender } = require('./chessGame');
const { renderBoard } = require('./renderBoard');
const { addGold } = require('./profiles');
const { isAdmin } = require('./adminSettings');
const { ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

const tournamentsFile = path.join(__dirname, 'tournaments.json');

async function loadTournaments() {
  try {
    const data = await fs.readFile(tournamentsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveTournaments(tournaments) {
  await fs.writeFile(tournamentsFile, JSON.stringify(tournaments, null, 2));
}

async function createTournament(creatorId, rounds, startTime, interaction) {
  const tournaments = await loadTournaments();
  const tournamentId = Date.now().toString();
  const tournament = {
    id: tournamentId,
    creatorId,
    rounds,
    startTime,
    participants: [creatorId],
    status: 'open',
    currentRound: 0,
    matches: [],
    standings: {}
  };
  tournaments[tournamentId] = tournament;
  await saveTournaments(tournaments);
  interaction.client.tournaments.set(tournamentId, tournament);

  setTimeout(async () => {
    const t = (await loadTournaments())[tournamentId];
    if (t && t.status === 'open') {
      await startTournament(creatorId, interaction, tournamentId);
    }
  }, (startTime * 1000 - Date.now()));

  return `Tournament created! ID: ${tournamentId}\nRounds: ${rounds}\nStarts: <t:${startTime}:f>\nUse /join-tournament to join!`;
}

async function joinTournament(userId, interaction) {
  const tournaments = await loadTournaments();
  const openTournament = Object.values(tournaments).find(t => t.status === 'open');
  if (!openTournament) {
    return 'No open tournaments found!';
  }
  if (openTournament.participants.includes(userId)) {
    return 'You are already in this tournament!';
  }
  if (openTournament.startTime * 1000 < Date.now()) {
    return 'Tournament registration is closed!';
  }
  openTournament.participants.push(userId);
  await saveTournaments(tournaments);
  interaction.client.tournaments.set(openTournament.id, openTournament);
  return `Joined tournament ${openTournament.id}! Starts: <t:${openTournament.startTime}:f>`;
}

async function startTournament(userId, interaction, specificTournamentId = null) {
  const tournaments = await loadTournaments();
  let tournament;
  if (specificTournamentId) {
    tournament = tournaments[specificTournamentId];
    if (!tournament) {
      return 'Tournament not found!';
    }
    // Check if user is creator, bot admin, or server owner
    const hasPermission = tournament.creatorId === userId || await isAdmin(userId, interaction.guild.ownerId);
    if (!hasPermission) {
      return 'Only the creator, server owner, or a bot admin can start the tournament!';
    }
  } else {
    tournament = Object.values(tournaments).find(t => t.status === 'open' && t.startTime * 1000 <= Date.now());
    if (!tournament) {
      return 'No tournaments ready to start!';
    }
  }

  if (tournament.participants.length < 2) {
    return 'Not enough participants to start the tournament!';
  }

  tournament.status = 'active';
  tournament.currentRound = 1;
  await generateRoundMatches(tournament, interaction);
  await saveTournaments(tournaments);
  interaction.client.tournaments.set(tournament.id, tournament);
  return `Tournament ${tournament.id} started! Round 1 matches posted.`;
}

async function generateRoundMatches(tournament, interaction) {
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText || !interaction.channel.permissionsFor(interaction.client.user).has('CreatePrivateThreads')) {
    await interaction.channel?.send({ content: 'Cannot create match threads in this channel! Please use a text channel where I have permission to create threads.' });
    return;
  }

  const participants = [...tournament.participants];
  if (participants.length % 2 === 1) {
    participants.push(null); // Add bye for odd number of players
  }
  const matches = [];
  const n = participants.length;
  for (let i = 0; i < n / 2; i++) {
    const white = participants[i];
    const black = participants[n - 1 - i];
    if (white && black) {
      const matchId = `${tournament.id}_${tournament.currentRound}_${i}`;
      const game = await startGame(white, black, null);
      const thread = await interaction.channel.threads.create({
        name: `Tournament ${tournament.id} Round ${tournament.currentRound}: <@${white}> vs <@${black}>`,
        autoArchiveDuration: 60,
        type: ChannelType.PrivateThread
      });
      game.threadId = thread.id;
      const boardImage = await renderBoard(game.chess.fen(), white);
      const moves = game.chess.moves({ verbose: true });
      const buttons = moves.map(move => new ButtonBuilder()
        .setCustomId(`tournament_move_${tournament.id}_${matchId}_${move.from}_${move.to}`)
        .setLabel(`${move.piece} ${move.from} to ${move.to}`)
        .setStyle(ButtonStyle.Primary));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tournament_draw_${tournament.id}_${matchId}`).setLabel('Offer Draw').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tournament_surrender_${tournament.id}_${matchId}`).setLabel('Surrender').setStyle(ButtonStyle.Danger)
      );
      const moveRows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        moveRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }
      await thread.send({
        content: `**Tournament Match: <@${white}> vs <@${black}>**\nWhite: <@${white}>\nBlack: <@${black}>\nTurn: <@${white}>`,
        files: [{ attachment: boardImage, name: 'board.png' }],
        components: [...moveRows, row]
      });
      matches.push({ id: matchId, white, black, game, threadId: thread.id });
    }
  }
  tournament.matches = matches;
  for (const participant of tournament.participants) {
    if (participant) {
      tournament.standings[participant] = tournament.standings[participant] || { points: 0, wins: 0, draws: 0, losses: 0 };
    }
  }
}

async function updateTournament(tournamentId, interaction) {
  const tournaments = await loadTournaments();
  const tournament = tournaments[tournamentId];
  if (!tournament) return;

  for (const match of tournament.matches) {
    if (match.result) {
      if (match.result.winner) {
        tournament.standings[match.result.winner].points += 1;
        tournament.standings[match.result.winner].wins += 1;
        const loser = match.white === match.result.winner ? match.black : match.white;
        tournament.standings[loser].losses += 1;
      } else if (match.result.draw) {
        tournament.standings[match.white].points += 0.5;
        tournament.standings[match.white].draws += 1;
        tournament.standings[match.black].points += 0.5;
        tournament.standings[match.black].draws += 1;
      }
    }
  }

  if (tournament.matches.every(m => m.result)) {
    if (tournament.currentRound < tournament.rounds) {
      tournament.currentRound += 1;
      const participants = [...tournament.participants];
      if (participants.length % 2 === 1) {
        participants.push(null);
      }
      const first = participants.shift();
      participants.push(first);
      tournament.participants = participants.filter(p => p);
      tournament.matches = [];
      await generateRoundMatches(tournament, interaction);
      await interaction.channel?.send(`Tournament ${tournamentId} Round ${tournament.currentRound} started!`);
    } else {
      tournament.status = 'completed';
      const sortedStandings = Object.entries(tournament.standings)
        .sort(([, a], [, b]) => b.points - a.points);
      const winner = sortedStandings[0][0];
      await addGold(winner, 100);
      await interaction.channel?.send(`Tournament ${tournamentId} completed! Winner: <@${winner}>`);
    }
  }
  await saveTournaments(tournaments);
  interaction.client.tournaments.set(tournamentId, tournament);
}

async function getStandings(interaction) {
  const tournaments = await loadTournaments();
  const activeTournament = Object.values(tournaments).find(t => t.status === 'active' || t.status === 'completed');
  if (!activeTournament) {
    return 'No active or completed tournaments found!';
  }
  const standings = Object.entries(activeTournament.standings)
    .sort(([, a], [, b]) => b.points - a.points)
    .map(([id, s], i) => `${i + 1}. <@${id}>: ${s.points} points (W:${s.wins}, D:${s.draws}, L:${s.losses})`)
    .join('\n');
  return `**Tournament ${activeTournament.id} Standings**\nRound ${activeTournament.currentRound}/${activeTournament.rounds}\n${standings || 'No standings yet!'}`;
}

module.exports = { createTournament, joinTournament, startTournament, getStandings };