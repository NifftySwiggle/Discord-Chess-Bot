
import { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, SlashCommandBuilder, ChannelType, InteractionResponseType, StringSelectMenuBuilder } from 'discord.js';
import { Chess } from 'chess.js';
import { renderBoard } from './renderBoard.js';
import { getProfile, updateProfile, addGold, getAllProfiles } from './profiles.js';
import { startGame, makeMove, offerDraw, acceptDraw, declineDraw, surrender } from './chessGame.js';
import { getShopItems, buyItem, addShopItem, removeShopItem } from './shop.js';
import { createTournament, joinTournament, startTournament, getStandings } from './tournaments.js';
import { makeAIMove } from './aiOpponent.js';
import { isAdmin, addAdmin, removeAdmin, listAdmins, setArchiveChannel, getArchiveChannel } from './adminSettings.js';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const games = new Map();
const tournaments = new Map();
const openGames = new Map(); // Store open games waiting for opponents

// Helper function to get unique pieces that can move
function getMovablePieces(chess, userId, game) {
  const moves = chess.moves({ verbose: true });
  const pieces = new Map(); // Map of piece type -> array of from squares
  
  moves.forEach(move => {
    const pieceKey = move.piece.toUpperCase();
    if (!pieces.has(pieceKey)) {
      pieces.set(pieceKey, new Set());
    }
    pieces.get(pieceKey).add(move.from);
  });
  
  return pieces;
}

// Helper function to create piece selection buttons
function createPieceButtons(pieces) {
  const pieceNames = {
    'P': '♟ Pawn',
    'N': '♞ Knight', 
    'B': '♝ Bishop',
    'R': '♜ Rook',
    'Q': '♛ Queen',
    'K': '♚ King'
  };
  
  const buttons = [];
  for (const [piece, squares] of pieces.entries()) {
    if (squares.size > 0) {
      buttons.push(new ButtonBuilder()
        .setCustomId(`select_piece_${piece}`)
        .setLabel(`${pieceNames[piece]} (${squares.size})`)
        .setStyle(ButtonStyle.Primary));
    }
  }
  
  return buttons;
}

// Helper function to create move buttons for a specific piece
function createMoveButtonsForPiece(chess, pieceType, fromSquares) {
  const moves = chess.moves({ verbose: true });
  const pieceMoves = moves.filter(move => 
    move.piece.toUpperCase() === pieceType && fromSquares.has(move.from)
  );
  
  return pieceMoves.map(move => new ButtonBuilder()
    .setCustomId(`move_${move.from}_${move.to}`)
    .setLabel(`${move.from} → ${move.to}${move.captured ? ' ✕' : ''}`)
    .setStyle(move.captured ? ButtonStyle.Danger : ButtonStyle.Primary));
}

// Function to archive and delete game thread
async function archiveAndDeleteThread(thread, guild, gameInfo) {
  try {
    const archiveChannelId = await getArchiveChannel();
    
    if (archiveChannelId) {
      const archiveChannel = await guild.channels.fetch(archiveChannelId);
      
      if (archiveChannel) {
        // Create archive message
        let archiveMessage = `**🏁 Game Finished**\n`;
        archiveMessage += `**Players:** ${gameInfo.players}\n`;
        archiveMessage += `**Result:** ${gameInfo.result}\n`;
        archiveMessage += `**Date:** ${new Date().toLocaleString()}\n`;
        archiveMessage += `**Thread:** ${thread.name}`;
        
        await archiveChannel.send(archiveMessage);
      }
    }
    
    // Notify players that thread will be deleted
    await thread.send('⏱️ This thread will be automatically deleted in 1 minute.');
    
    // Delete thread after 1 minute
    setTimeout(async () => {
      try {
        await thread.delete();
      } catch (error) {
        console.error('Failed to delete thread:', error);
      }
    }, 60000); // 1 minute
  } catch (error) {
    console.error('Failed to archive game:', error);
  }
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  const commands = [
    new SlashCommandBuilder()
      .setName('chess-challenge')
      .setDescription('Challenge another user to a chess game')
      .addUserOption(option => option.setName('opponent').setDescription('The user to challenge').setRequired(true)),
    new SlashCommandBuilder()
      .setName('chess-ai')
      .setDescription('Play chess against the AI'),
    new SlashCommandBuilder()
      .setName('chess-open')
      .setDescription('Create an open game that anyone can join'),
    new SlashCommandBuilder()
      .setName('profile')
      .setDescription('View your profile'),
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View the leaderboard'),
    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('View the shop'),
    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Buy an item from the shop'),
    new SlashCommandBuilder()
      .setName('create-tournament')
      .setDescription('Create a round-robin tournament')
      .addIntegerOption(option => option.setName('rounds').setDescription('Number of rounds').setRequired(true).setMinValue(1))
      .addStringOption(option => option.setName('start').setDescription('Start time (Unix timestamp)').setRequired(true)),
    new SlashCommandBuilder()
      .setName('join-tournament')
      .setDescription('Join an open tournament'),
    new SlashCommandBuilder()
      .setName('start-tournament')
      .setDescription('Manually start a tournament (admin only)'),
    new SlashCommandBuilder()
      .setName('tournament-standings')
      .setDescription('View current tournament standings'),
    new SlashCommandBuilder()
      .setName('give-gold')
      .setDescription('Give gold to a user (Admin only)')
      .addUserOption(option => option.setName('user').setDescription('The user to give gold to').setRequired(true))
      .addIntegerOption(option => option.setName('amount').setDescription('Amount of gold to give').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('set-board-theme')
      .setDescription('Change your board theme')
      .addStringOption(option => 
        option.setName('theme')
          .setDescription('Board theme to use')
          .setRequired(true)
          .addChoices(
            { name: 'Default', value: 'default' },
            { name: 'Blue', value: 'blue' },
            { name: 'Wooden', value: 'wood' },
            { name: 'Green', value: 'green' },
            { name: 'Purple', value: 'purple' },
            { name: 'Red', value: 'red' },
            { name: 'Marble', value: 'marble' },
            { name: 'Neon', value: 'neon' }
          )
      ),
    new SlashCommandBuilder()
      .setName('set-piece-theme')
      .setDescription('Change your piece theme')
      .addStringOption(option => 
        option.setName('theme')
          .setDescription('Piece theme to use')
          .setRequired(true)
          .addChoices(
            { name: 'Unicode (Free)', value: 'unicode' },
            { name: 'Standard', value: 'standard' },
            { name: 'Origins', value: 'origins' }
          )
      ),
    new SlashCommandBuilder()
      .setName('add-admin')
      .setDescription('Add a bot admin (Owner only)')
      .addUserOption(option => option.setName('user').setDescription('The user to make admin').setRequired(true)),
    new SlashCommandBuilder()
      .setName('remove-admin')
      .setDescription('Remove a bot admin (Owner only)')
      .addUserOption(option => option.setName('user').setDescription('The admin to remove').setRequired(true)),
    new SlashCommandBuilder()
      .setName('list-admins')
      .setDescription('List all bot admins'),
    new SlashCommandBuilder()
      .setName('show-admins')
      .setDescription('Show all users with admin permissions'),
    new SlashCommandBuilder()
      .setName('add-shop-item')
      .setDescription('Add a role item to the shop (Admin only)')
      .addStringOption(option => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption(option => option.setName('cost').setDescription('Gold cost').setRequired(true).setMinValue(1))
      .addRoleOption(option => option.setName('role').setDescription('Role to give when purchased').setRequired(true)),
    new SlashCommandBuilder()
      .setName('remove-shop-item')
      .setDescription('Remove an item from the shop (Admin only)')
      .addStringOption(option => option.setName('name').setDescription('Item name to remove').setRequired(true)),
    new SlashCommandBuilder()
      .setName('set-archive-channel')
      .setDescription('Set the channel for game archives (Admin only)')
      .addChannelOption(option => option.setName('channel').setDescription('Archive channel').setRequired(true)),
    new SlashCommandBuilder()
      .setName('clear-archives')
      .setDescription('Clear archived games (Admin only)')
      .addIntegerOption(option => option.setName('count').setDescription('Number of messages to clear (default: all)').setMinValue(1)),
    new SlashCommandBuilder()
      .setName('daily')
      .setDescription('Claim your daily gold and streak reward')
  ];

  client.application.commands.set(commands);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isButton() && !interaction.isStringSelectMenu()) return;

  if (interaction.isCommand()) {
    const { commandName, user, options } = interaction;

    if (commandName === 'daily') {
      await interaction.deferReply();
      const profile = await getProfile(user.id);
      const today = new Date();
      const lastDaily = profile.lastDaily ? new Date(profile.lastDaily) : null;
      const streak = profile.dailyStreak || 0;
      let newStreak = streak;
      let reward = 50;
      let message = '';

      // Check if already claimed today
      if (lastDaily && lastDaily.toDateString() === today.toDateString()) {
        message = `You have already claimed your daily gold today!\n\nCurrent streak: **${streak} days**.`;
        await interaction.followUp({ content: message, flags: InteractionResponseType.Ephemeral });
        return;
      }

      // Check if yesterday was last claim
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      if (lastDaily && lastDaily.toDateString() === yesterday.toDateString()) {
        newStreak = streak + 1;
      } else {
        newStreak = 1;
      }

      // Calculate reward: base 10, +2 per streak day up to 7 days (max 22)
      reward = 10 + Math.min(newStreak - 1, 6) * 2;

      // Update profile
      await updateProfile(user.id, {
        gold: (profile.gold || 0) + reward,
        lastDaily: today.toISOString(),
        dailyStreak: newStreak
      });

      message = `You claimed **${reward} gold** for your daily!\nStreak: **${newStreak} days**.\n\nKeep your streak going for more gold (max 7 days)!`;
      await interaction.followUp({ content: message, flags: InteractionResponseType.Ephemeral });
      return;
    }
    // ...existing code...
      const opponent = options.getUser('opponent');
      if (opponent.id === user.id) {
        await interaction.reply({ content: 'You cannot challenge yourself!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (games.has(user.id)) {
        const endGameButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`end_existing_game_${user.id}`)
              .setLabel('End Current Game')
              .setStyle(ButtonStyle.Danger)
          );
        await interaction.reply({ 
          content: 'You are already in a game! Click the button below to end it.', 
          components: [endGameButton],
          flags: InteractionResponseType.Ephemeral 
        });
        return;
      }
      if (games.has(opponent.id)) {
        await interaction.reply({ content: 'Opponent is already in a game!', flags: InteractionResponseType.Ephemeral });
        return;
      }

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId(`accept_${user.id}_${opponent.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('decline').setLabel('Decline').setStyle(ButtonStyle.Danger)
        );

      await interaction.reply({
        content: `<@${user.id}> has challenged <@${opponent.id}> to a chess game!`,
        components: [row]
      });
    } else if (commandName === 'chess-ai') {
      const channel = interaction.channel;
      if (games.has(user.id)) {
        const endGameButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`end_existing_game_${user.id}`)
              .setLabel('End Current Game')
              .setStyle(ButtonStyle.Danger)
          );
        await interaction.reply({ 
          content: 'You are already in a game! Click the button below to end it.', 
          components: [endGameButton],
          flags: InteractionResponseType.Ephemeral 
        });
        return;
      }
      if (!channel || channel.type !== ChannelType.GuildText || !channel.permissionsFor(client.user).has('CreatePrivateThreads')) {
        await interaction.reply({ content: 'Cannot create a game thread in this channel! Please use a text channel where I have permission to create threads.', flags: InteractionResponseType.Ephemeral });
        return;
      }

      await interaction.deferReply();

      const thread = await channel.threads.create({
        name: `Chess: <@${user.id}> vs AI`,
        autoArchiveDuration: 60,
        type: ChannelType.PrivateThread
      });

      const game = await startGame(user.id, 'AI', thread.id);
      game.isAI = true;
      games.set(user.id, game);

      let boardImage;
      try {
        boardImage = await renderBoard(game.chess.fen(), user.id);
      } catch (error) {
        console.error('Failed to render board:', error);
        await interaction.followUp({ content: 'Failed to render the chess board. Please try again.', flags: InteractionResponseType.Ephemeral });
        games.delete(user.id);
        return;
      }

      const pieces = getMovablePieces(game.chess, user.id, game);
      const pieceButtons = createPieceButtons(pieces);
      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('surrender').setLabel('Surrender').setStyle(ButtonStyle.Danger)
      );
      
      const pieceRows = [];
      for (let i = 0; i < pieceButtons.length; i += 5) {
        pieceRows.push(new ActionRowBuilder().addComponents(pieceButtons.slice(i, i + 5)));
      }

      await thread.send({
        content: `**<@${user.id}> vs AI**\nWhite: <@${user.id}> (to move)\nBlack: AI\n\n**Select a piece to move:**`,
        files: [{ attachment: boardImage, name: 'board.png' }],
        components: [...pieceRows, controlRow]
      });

      await interaction.followUp({ content: 'AI game started! Check the thread.', flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'chess-open') {
      const channel = interaction.channel;
      if (games.has(user.id)) {
        const endGameButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`end_existing_game_${user.id}`)
              .setLabel('End Current Game')
              .setStyle(ButtonStyle.Danger)
          );
        await interaction.reply({ 
          content: 'You are already in a game! Click the button below to end it.', 
          components: [endGameButton],
          flags: InteractionResponseType.Ephemeral 
        });
        return;
      }
      if (!channel || channel.type !== ChannelType.GuildText || !channel.permissionsFor(client.user).has('CreatePrivateThreads')) {
        await interaction.reply({ content: 'Cannot create a game thread in this channel! Please use a text channel where I have permission to create threads.', flags: InteractionResponseType.Ephemeral });
        return;
      }

      // Create open game
      const openGameId = `open_${user.id}_${Date.now()}`;
      openGames.set(openGameId, {
        creator: user.id,
        channel: channel,
        createdAt: Date.now()
      });

      const joinButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`join_open_${openGameId}`)
            .setLabel('Join Game')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`cancel_open_${openGameId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
        );

      await interaction.reply({
        content: `🎮 <@${user.id}> has opened a chess game!\n**First player to click "Join Game" will play!**`,
        components: [joinButton]
      });

      // Auto-cancel after 5 minutes
      setTimeout(() => {
        if (openGames.has(openGameId)) {
          openGames.delete(openGameId);
        }
      }, 300000);
    } else if (commandName === 'profile') {
      await interaction.deferReply();
      const profile = await getProfile(user.id);
      const dailyStatus = profile.lastDaily && new Date(profile.lastDaily).toDateString() === new Date().toDateString()
        ? 'Completed'
        : 'Available';
      
      // Daily challenge info
      const dailyChallenge = dailyStatus === 'Available' 
        ? '🎯 **Daily Challenge:** Win a game to earn 50 gold!' 
        : '✅ **Daily Challenge:** Completed (Come back tomorrow!)';
      
      // Get user's roles from the shop
      const shopItems = await getShopItems();
      const roleItems = shopItems.filter(item => item.type === 'role');
      const userRoles = [];
      
      for (const item of roleItems) {
        try {
          const member = await interaction.guild.members.fetch(user.id);
          if (member.roles.cache.has(item.roleId)) {
            userRoles.push(item.name);
          }
        } catch (error) {
          console.error('Error checking roles:', error);
        }
      }
      
      // Build inventory display
      const boardThemes = profile.inventory?.boardThemes || ['default'];
      const pieceThemes = profile.inventory?.pieceThemes || ['unicode'];
      
      let profileMessage = `**📊 ${user.username}'s Profile**\n\n`;
      profileMessage += `**💰 Gold:** ${profile.gold || 0}\n`;
      profileMessage += `**🏆 Wins:** ${profile.wins || 0}\n`;
      profileMessage += `**💔 Losses:** ${profile.losses || 0}\n\n`;
      
      profileMessage += dailyChallenge + `\n\n`;
      
      profileMessage += `**🎨 Active Theme:**\n`;
      profileMessage += `• Board: **${profile.boardTheme || 'default'}**\n`;
      profileMessage += `• Pieces: **${profile.pieceTheme || 'unicode'}**\n\n`;
      
      profileMessage += `**🎨 Owned Themes:**\n`;
      profileMessage += `• Boards: ${boardThemes.join(', ')}\n`;
      profileMessage += `• Pieces: ${pieceThemes.join(', ')}\n`;
      
      if (userRoles.length > 0) {
        profileMessage += `\n**👑 Shop Roles:**\n`;
        profileMessage += userRoles.map(role => `• ${role}`).join('\n');
      }
      
      await interaction.followUp({ content: profileMessage });
    } else if (commandName === 'leaderboard') {
      await interaction.deferReply();
      const profiles = await getAllProfiles();
      const sorted = Object.entries(profiles)
        .sort(([, a], [, b]) => (b.gold || 0) - (a.gold || 0))
        .slice(0, 10);

      if (sorted.length === 0) {
        await interaction.followUp({ content: 'No players have gold yet!' });
        return;
      }

      const page = 1;
      const leaderboard = sorted.map(([id, p], i) => `${i + 1}. <@${id}>: ${p.gold || 0} gold`).join('\n');
      await interaction.followUp({ content: `**Chess Leaderboard (Page ${page})**\n${leaderboard}` });
    } else if (commandName === 'shop') {
      const items = await getShopItems();
      const shopList = items.map(item => `${item.name} - ${item.cost} gold (${item.type})`).join('\n');
      await interaction.reply({ content: `**Shop**\n${shopList}\nUse /buy to purchase.` });
    } else if (commandName === 'buy') {
      const items = await getShopItems();
      const profile = await getProfile(user.id);
      
      if (items.length === 0) {
        await interaction.reply({ content: 'The shop is currently empty!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      // Create select menu options with balance and cost info
      const options = items.map(item => {
        const canAfford = profile.gold >= item.cost;
        const emoji = canAfford ? '✅' : '❌';
        let label = `${item.name} - ${item.cost} gold`;
        if (label.length > 100) label = label.substring(0, 97) + '...';
        
        return {
          label: label,
          value: item.name,
          description: `Type: ${item.type} | ${canAfford ? 'You can afford this!' : 'Not enough gold'}`,
          emoji: emoji
        };
      });
      
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('buy_item_select')
        .setPlaceholder('Select an item to purchase')
        .addOptions(options.slice(0, 25)); // Discord limit of 25 options
      
      const row = new ActionRowBuilder().addComponents(selectMenu);
      
      await interaction.reply({
        content: `**Your Balance:** ${profile.gold} gold\n\nSelect an item to purchase:`,
        components: [row],
        flags: InteractionResponseType.Ephemeral
      });
    } else if (commandName === 'create-tournament') {
      const rounds = options.getInteger('rounds');
      const startTime = options.getString('start');
      const startTimestamp = parseInt(startTime);
      if (isNaN(startTimestamp) || startTimestamp < Math.floor(Date.now() / 1000) + 600) {
        await interaction.reply({ content: 'Start time must be a valid Unix timestamp at least 10 minutes in the future!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const result = await createTournament(user.id, rounds, startTimestamp, interaction);
      await interaction.reply({ content: result });
    } else if (commandName === 'join-tournament') {
      const result = await joinTournament(user.id, interaction);
      await interaction.reply({ content: result, flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'start-tournament') {
      const result = await startTournament(user.id, interaction);
      await interaction.reply({ content: result, flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'tournament-standings') {
      await interaction.deferReply();
      const standings = await getStandings(interaction);
      await interaction.followUp({ content: standings });
    } else if (commandName === 'give-gold') {
      // Check if user is bot admin or server owner
      const hasPermission = await isAdmin(user.id, interaction.guild.ownerId);
      if (!hasPermission) {
        await interaction.reply({ content: 'You do not have permission to use this command!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      const targetUser = options.getUser('user');
      const amount = options.getInteger('amount');
      
      await addGold(targetUser.id, amount);
      await interaction.reply({ content: `Successfully gave ${amount} gold to ${targetUser.username}!`, flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'add-admin') {
      // Only server owner can manage admins
      if (user.id !== interaction.guild.ownerId) {
        await interaction.reply({ content: 'Only the server owner can add admins!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      const targetUser = options.getUser('user');
      const added = await addAdmin(targetUser.id);
      
      if (added) {
        await interaction.reply({ content: `${targetUser.username} has been added as a bot admin!`, flags: InteractionResponseType.Ephemeral });
      } else {
        await interaction.reply({ content: `${targetUser.username} is already a bot admin!`, flags: InteractionResponseType.Ephemeral });
      }
    } else if (commandName === 'remove-admin') {
      // Only server owner can manage admins
      if (user.id !== interaction.guild.ownerId) {
        await interaction.reply({ content: 'Only the server owner can remove admins!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      const targetUser = options.getUser('user');
      const removed = await removeAdmin(targetUser.id);
      
      if (removed) {
        await interaction.reply({ content: `${targetUser.username} has been removed as a bot admin!`, flags: InteractionResponseType.Ephemeral });
      } else {
        await interaction.reply({ content: `${targetUser.username} is not a bot admin!`, flags: InteractionResponseType.Ephemeral });
      }
    } else if (commandName === 'list-admins') {
      const adminIds = await listAdmins();
      
      if (adminIds.length === 0) {
        await interaction.reply({ content: 'No bot admins set. The server owner always has admin privileges.', flags: InteractionResponseType.Ephemeral });
      } else {
        const adminList = adminIds.map(id => `<@${id}>`).join('\n');
        await interaction.reply({ content: `**Bot Admins:**\n${adminList}\n\n*Server owner: <@${interaction.guild.ownerId}>*`, flags: InteractionResponseType.Ephemeral });
      }
    } else if (commandName === 'show-admins') {
      await interaction.deferReply();
      const adminIds = await listAdmins();
      const guild = interaction.guild;
      
      // Build embed-style message with all admin info
      let adminInfo = `**🛡️ Server Admin Panel**\n\n`;
      adminInfo += `**Server Owner:**\n<@${guild.ownerId}> (Always has admin privileges)\n\n`;
      
      if (adminIds.length === 0) {
        adminInfo += `**Bot Admins:** None\n\nUse \`/add-admin\` to add bot admins.`;
      } else {
        adminInfo += `**Bot Admins (${adminIds.length}):**\n`;
        for (const id of adminIds) {
          try {
            const member = await guild.members.fetch(id);
            adminInfo += `• ${member.user.tag} (<@${id}>)\n`;
          } catch (error) {
            adminInfo += `• <@${id}> (User not found in server)\n`;
          }
        }
      }
      
      adminInfo += `\n**Admin Privileges:**\n`;
      adminInfo += `✓ Give gold to users\n`;
      adminInfo += `✓ Manage shop items\n`;
      adminInfo += `✓ Start tournaments early\n`;
      
      await interaction.followUp({ content: adminInfo });
    } else if (commandName === 'set-board-theme') {
      const theme = options.getString('theme');
      const profile = await getProfile(user.id);
      
      // Check if user owns this theme
      if (!profile.inventory.boardThemes.includes(theme)) {
        await interaction.reply({ content: `You don't own this board theme! Purchase it from the shop first using \`/buy\`.`, flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      await updateProfile(user.id, { boardTheme: theme });
      await interaction.reply({ content: `Board theme changed to **${theme}**!`, flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'set-piece-theme') {
      const theme = options.getString('theme');
      const profile = await getProfile(user.id);
      
      // Check if user owns this theme
      if (!profile.inventory.pieceThemes.includes(theme)) {
        await interaction.reply({ content: `You don't own this piece theme! Purchase it from the shop first using \`/buy\`.`, flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      await updateProfile(user.id, { pieceTheme: theme });
      await interaction.reply({ content: `Piece theme changed to **${theme}**!`, flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'add-shop-item') {
      // Check if user is bot admin or server owner
      const hasPermission = await isAdmin(user.id, interaction.guild.ownerId);
      if (!hasPermission) {
        await interaction.reply({ content: 'You do not have permission to use this command!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      const name = options.getString('name');
      const cost = options.getInteger('cost');
      const role = options.getRole('role');
      
      const result = await addShopItem(name, cost, 'role', role.id);
      await interaction.reply({ content: result.message, flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'remove-shop-item') {
      // Check if user is bot admin or server owner
      const hasPermission = await isAdmin(user.id, interaction.guild.ownerId);
      if (!hasPermission) {
        await interaction.reply({ content: 'You do not have permission to use this command!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      const name = options.getString('name');
      const result = await removeShopItem(name);
      await interaction.reply({ content: result.message, flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'set-archive-channel') {
      // Check if user is bot admin or server owner
      const hasPermission = await isAdmin(user.id, interaction.guild.ownerId);
      if (!hasPermission) {
        await interaction.reply({ content: 'You do not have permission to use this command!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      const channel = options.getChannel('channel');
      await setArchiveChannel(channel.id);
      await interaction.reply({ content: `Archive channel set to <#${channel.id}>!`, flags: InteractionResponseType.Ephemeral });
    } else if (commandName === 'clear-archives') {
      // Check if user is bot admin or server owner
      const hasPermission = await isAdmin(user.id, interaction.guild.ownerId);
      if (!hasPermission) {
        await interaction.reply({ content: 'You do not have permission to use this command!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      await interaction.deferReply({ flags: InteractionResponseType.Ephemeral });
      
      const archiveChannelId = await getArchiveChannel();
      if (!archiveChannelId) {
        await interaction.followUp({ content: 'No archive channel set! Use `/set-archive-channel` first.', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      const count = options.getInteger('count');
      const archiveChannel = await interaction.guild.channels.fetch(archiveChannelId);
      
      if (!archiveChannel) {
        await interaction.followUp({ content: 'Archive channel not found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      try {
        if (count) {
          // Delete specific number of messages
          const messages = await archiveChannel.messages.fetch({ limit: count });
          await archiveChannel.bulkDelete(messages, true);
          await interaction.followUp({ content: `Cleared ${messages.size} archived games!`, flags: InteractionResponseType.Ephemeral });
        } else {
          // Delete all messages (in batches)
          let deleted = 0;
          let fetched;
          do {
            fetched = await archiveChannel.messages.fetch({ limit: 100 });
            if (fetched.size > 0) {
              await archiveChannel.bulkDelete(fetched, true);
              deleted += fetched.size;
            }
          } while (fetched.size >= 2);
          await interaction.followUp({ content: `Cleared ${deleted} archived games!`, flags: InteractionResponseType.Ephemeral });
        }
      } catch (error) {
        console.error('Error clearing archives:', error);
        await interaction.followUp({ content: 'Failed to clear archives!', flags: InteractionResponseType.Ephemeral });
      }
    }
  } else if (interaction.isStringSelectMenu()) {
    const { customId, user, values } = interaction;
    
    if (customId === 'buy_item_select') {
      await interaction.deferReply({ flags: InteractionResponseType.Ephemeral });
      const itemName = values[0];
      const result = await buyItem(user, interaction.guild, itemName);
      await interaction.followUp({ content: result, flags: InteractionResponseType.Ephemeral });
      
      // Update the original message to remove the select menu
      await interaction.message.edit({ components: [] });
    }
  } else if (interaction.isButton()) {
    const { customId, user, message, channel } = interaction;

    if (customId.startsWith('join_open_')) {
      const openGameId = customId.replace('join_open_', '');
      const openGame = openGames.get(openGameId);
      
      if (!openGame) {
        await interaction.reply({ content: 'This game is no longer available!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      if (user.id === openGame.creator) {
        await interaction.reply({ content: 'You cannot join your own game!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      if (games.has(user.id) || games.has(openGame.creator)) {
        await interaction.reply({ content: 'One of you is already in a game!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      // Defer update immediately to prevent timeout
      await interaction.deferUpdate();
      
      // Remove from open games
      openGames.delete(openGameId);
      
      // Create game thread
      const thread = await openGame.channel.threads.create({
        name: `Chess: <@${openGame.creator}> vs <@${user.id}>`,
        autoArchiveDuration: 60,
        type: ChannelType.PrivateThread
      });

      const game = await startGame(openGame.creator, user.id, thread.id);
      games.set(openGame.creator, game);
      games.set(user.id, game);

      const boardImage = await renderBoard(game.chess.fen(), openGame.creator);
      const pieces = getMovablePieces(game.chess, openGame.creator, game);
      const pieceButtons = createPieceButtons(pieces);
      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('draw').setLabel('Offer Draw').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('surrender').setLabel('Surrender').setStyle(ButtonStyle.Danger)
      );
      
      const pieceRows = [];
      for (let i = 0; i < pieceButtons.length; i += 5) {
        pieceRows.push(new ActionRowBuilder().addComponents(pieceButtons.slice(i, i + 5)));
      }

      await thread.send({
        content: `**<@${openGame.creator}> vs <@${user.id}>**\nWhite: <@${openGame.creator}> (to move)\nBlack: <@${user.id}>\n\n**Select a piece to move:**`,
        files: [{ attachment: boardImage, name: 'board.png' }],
        components: [...pieceRows, controlRow]
      });

      await interaction.editReply({
        content: `🎮 Game started! <@${openGame.creator}> vs <@${user.id}>`,
        components: []
      });
    } else if (customId.startsWith('cancel_open_')) {
      const openGameId = customId.replace('cancel_open_', '');
      const openGame = openGames.get(openGameId);
      
      if (!openGame) {
        await interaction.reply({ content: 'This game is no longer available!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      if (user.id !== openGame.creator) {
        await interaction.reply({ content: 'Only the game creator can cancel it!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      openGames.delete(openGameId);
      await interaction.update({
        content: `Game canceled by <@${user.id}>`,
        components: []
      });
    } else if (customId.startsWith('accept_')) {
      const [, challengerId, opponentId] = customId.split('_');
      if (user.id !== opponentId) {
        await interaction.reply({ content: 'Only the challenged user can accept this challenge!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (games.has(user.id) || games.has(challengerId)) {
        await interaction.reply({ content: 'One of you is already in a game!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (!channel || channel.type !== ChannelType.GuildText || !channel.permissionsFor(client.user).has('CreatePrivateThreads')) {
        await interaction.reply({ content: 'Cannot create a game thread in this channel! Please use a text channel where I have permission to create threads.', flags: InteractionResponseType.Ephemeral });
        return;
      }

      // Defer reply immediately to prevent timeout
      await interaction.deferReply({ flags: InteractionResponseType.Ephemeral });

      const thread = await channel.threads.create({
        name: `Chess: <@${challengerId}> vs <@${opponentId}>`,
        autoArchiveDuration: 60,
        type: ChannelType.PrivateThread
      });

      const game = await startGame(challengerId, opponentId, thread.id);
      games.set(challengerId, game);
      games.set(opponentId, game);

      const boardImage = await renderBoard(game.chess.fen(), challengerId);
      const pieces = getMovablePieces(game.chess, challengerId, game);
      const pieceButtons = createPieceButtons(pieces);
      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('draw').setLabel('Offer Draw').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('surrender').setLabel('Surrender').setStyle(ButtonStyle.Danger)
      );
      
      const pieceRows = [];
      for (let i = 0; i < pieceButtons.length; i += 5) {
        pieceRows.push(new ActionRowBuilder().addComponents(pieceButtons.slice(i, i + 5)));
      }

      await thread.send({
        content: `**<@${challengerId}> vs <@${opponentId}>**\nWhite: <@${challengerId}> (to move)\nBlack: <@${opponentId}>\n\n**Select a piece to move:**`,
        files: [{ attachment: boardImage, name: 'board.png' }],
        components: [...pieceRows, controlRow]
      });

      await interaction.followUp({ content: 'Challenge accepted!', flags: InteractionResponseType.Ephemeral });
    } else if (customId === 'decline') {
      await interaction.reply({ content: 'Challenge declined!', flags: InteractionResponseType.Ephemeral });
    } else if (customId.startsWith('select_piece_')) {
      await interaction.deferUpdate();
      
      const pieceType = customId.replace('select_piece_', '');
      const game = games.get(user.id);
      
      if (!game) {
        await interaction.followUp({ content: 'No active game found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      if (game.currentTurn !== user.id) {
        await interaction.followUp({ content: "It's not your turn!", flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      // Get all squares where this piece type can move from
      const moves = game.chess.moves({ verbose: true });
      const fromSquares = new Set();
      moves.forEach(move => {
        if (move.piece.toUpperCase() === pieceType) {
          fromSquares.add(move.from);
        }
      });
      
      // Create move buttons for this specific piece
      const moveButtons = createMoveButtonsForPiece(game.chess, pieceType, fromSquares);
      const backButton = new ButtonBuilder()
        .setCustomId('back_to_pieces')
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary);
      
      const controlRow = new ActionRowBuilder().addComponents(
        backButton,
        new ButtonBuilder().setCustomId('surrender').setLabel('Surrender').setStyle(ButtonStyle.Danger)
      );
      
      if (!game.isAI) {
        controlRow.addComponents(new ButtonBuilder().setCustomId('draw').setLabel('Offer Draw').setStyle(ButtonStyle.Secondary));
      }
      
      const moveRows = [];
      for (let i = 0; i < moveButtons.length && moveRows.length < 4; i += 5) {
        moveRows.push(new ActionRowBuilder().addComponents(moveButtons.slice(i, Math.min(i + 5, moveButtons.length))));
      }
      
      const pieceNames = {
        'P': 'Pawn',
        'N': 'Knight',
        'B': 'Bishop',
        'R': 'Rook',
        'Q': 'Queen',
        'K': 'King'
      };
      
      await interaction.editReply({
        content: `${interaction.message.content.split('\\n\\n')[0]}\\n\\n**${pieceNames[pieceType]} moves:**`,
        components: [...moveRows, controlRow]
      });
    } else if (customId === 'back_to_pieces') {
      await interaction.deferUpdate();
      
      const game = games.get(user.id);
      
      if (!game) {
        await interaction.followUp({ content: 'No active game found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      // Show piece selection again
      const pieces = getMovablePieces(game.chess, user.id, game);
      const pieceButtons = createPieceButtons(pieces);
      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('surrender').setLabel('Surrender').setStyle(ButtonStyle.Danger)
      );
      
      if (!game.isAI) {
        controlRow.addComponents(new ButtonBuilder().setCustomId('draw').setLabel('Offer Draw').setStyle(ButtonStyle.Secondary));
      }
      
      const pieceRows = [];
      for (let i = 0; i < pieceButtons.length; i += 5) {
        pieceRows.push(new ActionRowBuilder().addComponents(pieceButtons.slice(i, i + 5)));
      }
      
      await interaction.editReply({
        content: `${interaction.message.content.split('\\n\\n')[0]}\\n\\n**Select a piece to move:**`,
        components: [...pieceRows, controlRow]
      });
    } else if (customId.startsWith('move_')) {
      await interaction.deferReply({ flags: InteractionResponseType.Ephemeral });
      
      const [, from, to] = customId.split('_');
      const game = games.get(user.id);
      if (!game) {
        await interaction.followUp({ content: 'No active game found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (game.currentTurn !== user.id) {
        await interaction.followUp({ content: "It's not your turn!", flags: InteractionResponseType.Ephemeral });
        return;
      }

      const result = await makeMove(game, from, to);
      if (!result.valid) {
        await interaction.followUp({ content: 'Invalid move!', flags: InteractionResponseType.Ephemeral });
        return;
      }

      const boardImage = await renderBoard(game.chess.fen(), game.currentTurn);
      
      // Get piece selection buttons for the next turn
      const pieces = getMovablePieces(game.chess, game.currentTurn, game);
      const pieceButtons = createPieceButtons(pieces);
      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('surrender').setLabel('Surrender').setStyle(ButtonStyle.Danger)
      );
      if (!game.isAI) {
        controlRow.addComponents(new ButtonBuilder().setCustomId('draw').setLabel('Offer Draw').setStyle(ButtonStyle.Secondary));
      }
      
      const pieceRows = [];
      for (let i = 0; i < pieceButtons.length; i += 5) {
        pieceRows.push(new ActionRowBuilder().addComponents(pieceButtons.slice(i, i + 5)));
      }

      let content;
      if (game.isAI) {
        content = `**<@${user.id}> vs AI**\nWhite: <@${user.id}>\nBlack: AI\nTurn: <@${user.id}>`;
      } else {
        content = `**<@${game.white}> vs <@${game.black}>**\nWhite: <@${game.white}>\nBlack: <@${game.black}>\nTurn: <@${game.currentTurn}>`;
      }

      if (result.checkmate) {
        const winner = game.chess.turn() === 'w' ? game.black : game.white;
        if (!game.isAI) {
          await updateProfile(winner, { wins: 1 });
          await updateProfile(game.chess.turn() === 'w' ? game.white : game.black, { losses: 1 });
          await addGold(winner, 30);
          await addGold(game.chess.turn() === 'w' ? game.white : game.black, 10);
          games.delete(game.white);
          games.delete(game.black);
          content += `\nCheckmate! <@${winner}> wins!`;
          
          // Archive and schedule thread deletion
          await archiveAndDeleteThread(interaction.message.channel, interaction.guild, {
            players: `<@${game.white}> vs <@${game.black}>`,
            result: `<@${winner}> wins by checkmate!`
          });
        } else {
          await updateProfile(user.id, { wins: 1 });
          await addGold(user.id, 50);
          games.delete(user.id);
          content += `\nCheckmate! <@${user.id}> wins!`;
          
          // Archive and schedule thread deletion
          await archiveAndDeleteThread(interaction.message.channel, interaction.guild, {
            players: `<@${user.id}> vs AI`,
            result: `<@${user.id}> wins by checkmate!`
          });
        }
      } else if (result.draw) {
        if (!game.isAI) {
          await addGold(game.white, 10);
          await addGold(game.black, 10);
          games.delete(game.white);
          games.delete(game.black);
          content += '\nGame is a draw!';
          
          // Archive and schedule thread deletion
          await archiveAndDeleteThread(interaction.message.channel, interaction.guild, {
            players: `<@${game.white}> vs <@${game.black}>`,
            result: `Draw`
          });
        } else {
          await addGold(user.id, 10);
          games.delete(user.id);
          content += '\nGame is a draw!';
          
          // Archive and schedule thread deletion
          await archiveAndDeleteThread(interaction.message.channel, interaction.guild, {
            players: `<@${user.id}> vs AI`,
            result: `Draw`
          });
        }
      } else if (result.check) {
        content += '\nCheck!';
      }
      
      // Add piece selection instruction if game continues
      if (!result.checkmate && !result.draw) {
        content += '\n\n**Select a piece to move:**';
      }

      await interaction.message.edit({
        content,
        files: [{ attachment: boardImage, name: 'board.png' }],
        components: result.checkmate || result.draw ? [] : [...pieceRows, controlRow]
      });
      await interaction.followUp({ content: 'Move made!', flags: InteractionResponseType.Ephemeral });

      // If playing against AI and game is not over, make AI move
      if (game.isAI && !result.checkmate && !result.draw && game.currentTurn === 'AI') {
        setTimeout(async () => {
          try {
            const aiMove = makeAIMove(game);
            if (!aiMove) return;

            game.chess.move(aiMove);
            game.currentTurn = user.id;

            const aiResult = {
              valid: true,
              checkmate: game.chess.game_over() && game.chess.in_checkmate(),
              draw: game.chess.in_draw() || game.chess.in_stalemate() || game.chess.in_threefold_repetition(),
              check: game.chess.in_check()
            };

            const aiBoardImage = await renderBoard(game.chess.fen(), user.id);
            
            // Get piece selection for user's next move
            const pieces = getMovablePieces(game.chess, user.id, game);
            const pieceButtons = createPieceButtons(pieces);
            const aiControlRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('surrender').setLabel('Surrender').setStyle(ButtonStyle.Danger)
            );
            
            const aiPieceRows = [];
            for (let i = 0; i < pieceButtons.length; i += 5) {
              aiPieceRows.push(new ActionRowBuilder().addComponents(pieceButtons.slice(i, i + 5)));
            }

            let aiContent = `**<@${user.id}> vs AI**\nWhite: <@${user.id}>\nBlack: AI\nAI played: ${aiMove.san}`;
            if (aiResult.checkmate) {
              await updateProfile(user.id, { losses: 1 });
              games.delete(user.id);
              aiContent += `\nCheckmate! AI wins!`;
            } else if (aiResult.draw) {
              await addGold(user.id, 10);
              games.delete(user.id);
              aiContent += '\nGame is a draw!';
            } else if (aiResult.check) {
              aiContent += '\nCheck!';
            } else {
              aiContent += '\n<@' + user.id + '> to move\n\n**Select a piece to move:**';
            }

            const thread = await client.channels.fetch(game.threadId);
            await thread.send({
              content: aiContent,
              files: [{ attachment: aiBoardImage, name: 'board.png' }],
              components: aiResult.checkmate || aiResult.draw ? [] : [...aiPieceRows, aiControlRow]
            });
          } catch (error) {
            console.error('AI move error:', error);
          }
        }, 1500); // 1.5 second delay for more natural feel
      }
    } else if (customId === 'draw') {
      const game = games.get(user.id);
      if (!game) {
        await interaction.reply({ content: 'No active game found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      await offerDraw(game, user.id);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accept_draw').setLabel('Accept Draw').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('decline_draw').setLabel('Decline Draw').setStyle(ButtonStyle.Danger)
      );
      await interaction.message.edit({
        content: `${interaction.message.content}\n<@${user.id}> offers a draw!`,
        components: interaction.message.components.concat([row])
      });
      await interaction.reply({ content: 'Draw offered!', flags: InteractionResponseType.Ephemeral });
    } else if (customId === 'accept_draw') {
      const game = games.get(user.id);
      if (!game) {
        await interaction.reply({ content: 'No active game found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (game.drawOfferedBy === user.id) {
        await interaction.reply({ content: 'Cannot accept your own draw offer!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      await acceptDraw(game);
      await addGold(game.white, 10);
      await addGold(game.black, 10);
      games.delete(game.white);
      games.delete(game.black);
      await interaction.message.edit({
        content: `${interaction.message.content}\nDraw accepted!`,
        components: []
      });
      await interaction.reply({ content: 'Draw accepted!', flags: InteractionResponseType.Ephemeral });
      
      // Archive and schedule thread deletion
      await archiveAndDeleteThread(interaction.message.channel, interaction.guild, {
        players: `<@${game.white}> vs <@${game.black}>`,
        result: `Draw by agreement`
      });
    } else if (customId === 'decline_draw') {
      const game = games.get(user.id);
      if (!game) {
        await interaction.reply({ content: 'No active game found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      await declineDraw(game);
      await interaction.message.edit({
        content: interaction.message.content.replace(/\n<@.*> offers a draw!/, ''),
        components: interaction.message.components.filter(row => !row.components.some(c => c.customId === 'accept_draw'))
      });
      await interaction.reply({ content: 'Draw declined!', flags: InteractionResponseType.Ephemeral });
    } else if (customId === 'surrender') {
      const game = games.get(user.id);
      if (!game) {
        await interaction.reply({ content: 'No active game found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const result = await surrender(game, user.id);
      await updateProfile(result.winner, { wins: 1 });
      await updateProfile(user.id, { losses: 1 });
      await addGold(result.winner, 30);
      await addGold(user.id, 10);
      games.delete(game.white);
      games.delete(game.black);
      await interaction.message.edit({
        content: `${interaction.message.content}\n<@${user.id}> surrendered! <@${result.winner}> wins!`,
        components: []
      });
      await interaction.reply({ content: 'You surrendered!', flags: InteractionResponseType.Ephemeral });
      
      // Archive and schedule thread deletion
      await archiveAndDeleteThread(interaction.message.channel, interaction.guild, {
        players: `<@${game.white}> vs <@${game.black}>`,
        result: `<@${result.winner}> wins by surrender`
      });
    } else if (customId.startsWith('end_existing_game_')) {
      const userId = customId.split('_')[3];
      if (user.id !== userId) {
        await interaction.reply({ content: 'This is not your game!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const game = games.get(userId);
      if (!game) {
        await interaction.reply({ content: 'No active game found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      
      // End the game without winner/loser
      games.delete(game.white);
      games.delete(game.black);
      
      await interaction.reply({ content: 'Your current game has been ended. You can now start a new game!', flags: InteractionResponseType.Ephemeral });
      await interaction.message.edit({ components: [] });
    } else if (customId.startsWith('tournament_move_')) {
      const [, tournamentId, matchId, from, to] = customId.split('_');
      const tournament = tournaments.get(tournamentId);
      if (!tournament) {
        await interaction.reply({ content: 'Tournament not found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const match = tournament.matches.find(m => m.id === matchId);
      if (!match || match.result) {
        await interaction.reply({ content: 'Match not found or already completed!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (match.white !== user.id && match.black !== user.id) {
        await interaction.reply({ content: 'You are not a player in this match!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (match.currentTurn !== user.id) {
        await interaction.reply({ content: 'It’s not your turn!', flags: InteractionResponseType.Ephemeral });
        return;
      }

      const result = await makeMove(match.game, from, to);
      if (!result.valid) {
        await interaction.reply({ content: 'Invalid move!', flags: InteractionResponseType.Ephemeral });
        return;
      }

      const boardImage = await renderBoard(match.game.chess.fen(), match.currentTurn);
      const moves = match.game.chess.moves({ verbose: true });
      const buttons = moves.map(move => new ButtonBuilder()
        .setCustomId(`tournament_move_${tournamentId}_${matchId}_${move.from}_${move.to}`)
        .setLabel(`${move.piece} ${move.from} to ${move.to}`)
        .setStyle(ButtonStyle.Primary));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tournament_draw_${tournamentId}_${matchId}`).setLabel('Offer Draw').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tournament_surrender_${tournamentId}_${matchId}`).setLabel('Surrender').setStyle(ButtonStyle.Danger)
      );
      const moveRows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        moveRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }

      let content = `**Tournament Match: <@${match.white}> vs <@${match.black}>**\nWhite: <@${match.white}>\nBlack: <@${match.black}>\nTurn: <@${match.currentTurn}>`;
      if (result.checkmate) {
        match.result = { winner: match.game.chess.turn() === 'w' ? match.black : match.white };
        await updateProfile(match.result.winner, { wins: 1 });
        await updateProfile(match.game.chess.turn() === 'w' ? match.white : match.black, { losses: 1 });
        await addGold(match.result.winner, 30);
        await addGold(match.game.chess.turn() === 'w' ? match.white : match.black, 10);
        content += `\nCheckmate! <@${match.result.winner}> wins!`;
      } else if (result.draw) {
        match.result = { draw: true };
        await addGold(match.white, 10);
        await addGold(match.black, 10);
        content += '\nGame is a draw!';
      } else if (result.check) {
        content += '\nCheck!';
      }

      await interaction.message.edit({
        content,
        files: [{ attachment: boardImage, name: 'board.png' }],
        components: result.checkmate || result.draw ? [] : [...moveRows, row]
      });
      await interaction.reply({ content: 'Move made!', flags: InteractionResponseType.Ephemeral });

      if (result.checkmate || result.draw) {
        await updateTournament(tournamentId, interaction);
      }
    } else if (customId.startsWith('tournament_draw_')) {
      const [, tournamentId, matchId] = customId.split('_');
      const tournament = tournaments.get(tournamentId);
      if (!tournament) {
        await interaction.reply({ content: 'Tournament not found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const match = tournament.matches.find(m => m.id === matchId);
      if (!match || match.result) {
        await interaction.reply({ content: 'Match not found or already completed!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (match.white !== user.id && match.black !== user.id) {
        await interaction.reply({ content: 'You are not a player in this match!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      await offerDraw(match.game, user.id);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tournament_accept_draw_${tournamentId}_${matchId}`).setLabel('Accept Draw').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tournament_decline_draw_${tournamentId}_${matchId}`).setLabel('Decline Draw').setStyle(ButtonStyle.Danger)
      );
      await interaction.message.edit({
        content: `${interaction.message.content}\n<@${user.id}> offers a draw!`,
        components: interaction.message.components.concat([row])
      });
      await interaction.reply({ content: 'Draw offered!', flags: InteractionResponseType.Ephemeral });
    } else if (customId.startsWith('tournament_accept_draw_')) {
      const [, tournamentId, matchId] = customId.split('_');
      const tournament = tournaments.get(tournamentId);
      if (!tournament) {
        await interaction.reply({ content: 'Tournament not found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const match = tournament.matches.find(m => m.id === matchId);
      if (!match || match.result) {
        await interaction.reply({ content: 'Match not found or already completed!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (match.white !== user.id && match.black !== user.id) {
        await interaction.reply({ content: 'You are not a player in this match!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (match.game.drawOfferedBy === user.id) {
        await interaction.reply({ content: 'Cannot accept your own draw offer!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      match.result = { draw: true };
      await acceptDraw(match.game);
      await addGold(match.white, 10);
      await addGold(match.black, 10);
      await interaction.message.edit({
        content: `${interaction.message.content}\nDraw accepted!`,
        components: []
      });
      await interaction.reply({ content: 'Draw accepted!', flags: InteractionResponseType.Ephemeral });
      await updateTournament(tournamentId, interaction);
    } else if (customId.startsWith('tournament_decline_draw_')) {
      const [, tournamentId, matchId] = customId.split('_');
      const tournament = tournaments.get(tournamentId);
      if (!tournament) {
        await interaction.reply({ content: 'Tournament not found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const match = tournament.matches.find(m => m.id === matchId);
      if (!match) {
        await interaction.reply({ content: 'Match not found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      await declineDraw(match.game);
      await interaction.message.edit({
        content: interaction.message.content.replace(/\n<@.*> offers a draw!/, ''),
        components: interaction.message.components.filter(row => !row.components.some(c => c.customId.startsWith('tournament_accept_draw_')))
      });
      await interaction.reply({ content: 'Draw declined!', flags: InteractionResponseType.Ephemeral });
    } else if (customId.startsWith('tournament_surrender_')) {
      const [, tournamentId, matchId] = customId.split('_');
      const tournament = tournaments.get(tournamentId);
      if (!tournament) {
        await interaction.reply({ content: 'Tournament not found!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const match = tournament.matches.find(m => m.id === matchId);
      if (!match || match.result) {
        await interaction.reply({ content: 'Match not found or already completed!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      if (match.white !== user.id && match.black !== user.id) {
        await interaction.reply({ content: 'You are not a player in this match!', flags: InteractionResponseType.Ephemeral });
        return;
      }
      const result = await surrender(match.game, user.id);
      match.result = { winner: result.winner };
      await updateProfile(result.winner, { wins: 1 });
      await updateProfile(user.id, { losses: 1 });
      await addGold(result.winner, 30);
      await addGold(user.id, 10);
      await interaction.message.edit({
        content: `${interaction.message.content}\n<@${user.id}> surrendered! <@${result.winner}> wins!`,
        components: []
      });
      await interaction.reply({ content: 'You surrendered!', flags: InteractionResponseType.Ephemeral });
      await updateTournament(tournamentId, interaction);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);

// Minimal HTTP server for Render free web service
import http from 'http';
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord Chess Bot is running.');
}).listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// Self-ping mechanism to keep bot awake on Render
import fetch from 'node-fetch';
const SELF_URL = process.env.SELF_URL || `http://localhost:${PORT}`;
setInterval(() => {
  fetch(SELF_URL)
    .then(res => {
      if (res.ok) {
        console.log('Self-ping successful');
      } else {
        console.warn('Self-ping failed:', res.status);
      }
    })
    .catch(err => {
      console.warn('Self-ping error:', err.message);
    });
}, 5 * 60 * 1000); // Ping every 5 minutes
