const fs = require('fs').promises;
const path = require('path');

const adminFile = path.join(__dirname, '../adminSettings.json');

async function loadAdmins() {
  try {
    const data = await fs.readFile(adminFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Default structure if file doesn't exist
    return { admins: [], archiveChannelId: null };
  }
}

async function saveAdmins(adminData) {
  await fs.writeFile(adminFile, JSON.stringify(adminData, null, 2));
}

async function isAdmin(userId, guildOwnerId) {
  // Server owner is always admin
  if (userId === guildOwnerId) return true;
  
  const adminData = await loadAdmins();
  return adminData.admins.includes(userId);
}

async function addAdmin(userId) {
  const adminData = await loadAdmins();
  if (!adminData.admins.includes(userId)) {
    adminData.admins.push(userId);
    await saveAdmins(adminData);
    return true;
  }
  return false;
}

async function removeAdmin(userId) {
  const adminData = await loadAdmins();
  const index = adminData.admins.indexOf(userId);
  if (index > -1) {
    adminData.admins.splice(index, 1);
    await saveAdmins(adminData);
    return true;
  }
  return false;
}

async function listAdmins() {
  const adminData = await loadAdmins();
  return adminData.admins;
}

async function setArchiveChannel(channelId) {
  const adminData = await loadAdmins();
  adminData.archiveChannelId = channelId;
  await saveAdmins(adminData);
}

async function getArchiveChannel() {
  const adminData = await loadAdmins();
  return adminData.archiveChannelId;
}

module.exports = { isAdmin, addAdmin, removeAdmin, listAdmins, setArchiveChannel, getArchiveChannel };
