const fs = require('fs').promises;
const path = require('path');

const profilesFile = path.join(__dirname, '../profiles.json');

async function getProfile(userId) {
  const profiles = await loadProfiles();
  if (!profiles[userId]) {
    profiles[userId] = { 
      gold: 0, 
      wins: 0, 
      losses: 0, 
      lastDaily: null, 
      boardTheme: 'default', 
      pieceTheme: 'unicode',
      inventory: {
        boardThemes: ['default'],
        pieceThemes: ['unicode']
      }
    };
    await saveProfiles(profiles);
  }
  // Ensure pieceTheme exists for old profiles
  if (!profiles[userId].pieceTheme) {
    profiles[userId].pieceTheme = 'unicode';
  }
  // Ensure inventory exists for old profiles
  if (!profiles[userId].inventory) {
    profiles[userId].inventory = {
      boardThemes: [profiles[userId].boardTheme || 'default'],
      pieceThemes: [profiles[userId].pieceTheme || 'unicode']
    };
  }
  return profiles[userId];
}

async function loadProfiles() {
  try {
    const data = await fs.readFile(profilesFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveProfiles(profiles) {
  await fs.writeFile(profilesFile, JSON.stringify(profiles, null, 2));
}

async function updateProfile(userId, updates) {
  const profiles = await loadProfiles();
  profiles[userId] = { ...profiles[userId], ...updates };
  await saveProfiles(profiles);
}

async function addGold(userId, amount) {
  const profiles = await loadProfiles();
  if (!profiles[userId]) {
    profiles[userId] = { 
      gold: 0, 
      wins: 0, 
      losses: 0, 
      lastDaily: null, 
      boardTheme: 'default', 
      pieceTheme: 'unicode',
      inventory: {
        boardThemes: ['default'],
        pieceThemes: ['unicode']
      }
    };
  }
  profiles[userId].gold = (profiles[userId].gold || 0) + amount;
  if (amount === 50) { // Daily challenge
    const today = new Date().toISOString();
    profiles[userId].lastDaily = today;
  }
  await saveProfiles(profiles);
}

async function getAllProfiles() {
  return await loadProfiles();
}

export { getProfile, updateProfile, addGold, getAllProfiles };
