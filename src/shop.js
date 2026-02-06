
import { getProfile, updateProfile } from './profiles.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const shopItemsFile = path.join(__dirname, '../shopItems.json');

async function loadShopItems() {
  try {
    const data = await fs.readFile(shopItemsFile, 'utf8');
    return JSON.parse(data).items;
  } catch (error) {
    console.error('Failed to load shop items:', error);
    return [];
  }
}

async function saveShopItems(items) {
  await fs.writeFile(shopItemsFile, JSON.stringify({ items }, null, 2));
}

async function getShopItems() {
  return await loadShopItems();
}

async function addShopItem(name, cost, type, roleId = null, theme = null) {
  const items = await loadShopItems();
  
  // Check if item already exists
  if (items.find(i => i.name.toLowerCase() === name.toLowerCase())) {
    return { success: false, message: 'An item with this name already exists!' };
  }
  
  const newItem = { name, cost, type };
  if (type === 'role' && roleId) {
    newItem.roleId = roleId;
  } else if (type === 'boardTheme' && theme) {
    newItem.theme = theme;
  } else if (type === 'pieceTheme' && theme) {
    newItem.theme = theme;
  }
  
  items.push(newItem);
  await saveShopItems(items);
  return { success: true, message: `Added ${name} to the shop!` };
}

async function removeShopItem(name) {
  const items = await loadShopItems();
  const index = items.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
  
  if (index === -1) {
    return { success: false, message: 'Item not found in shop!' };
  }
  
  items.splice(index, 1);
  await saveShopItems(items);
  return { success: true, message: `Removed ${name} from the shop!` };
}

async function buyItem(user, guild, itemName) {
  const shopItems = await loadShopItems();
  const item = shopItems.find(i => i.name.toLowerCase() === itemName.toLowerCase());
  if (!item) return 'Item not found in the shop!';

  const profile = await getProfile(user.id);
  if (profile.gold < item.cost) return 'Not enough gold to buy this item!';

  if (item.type === 'role') {
    try {
      const role = guild.roles.cache.get(item.roleId);
      if (!role) return 'Role not found on the server!';
      if (guild.members.me.roles.highest.position <= role.position) {
        return 'Bot does not have permission to assign this role!';
      }
      await guild.members.cache.get(user.id).roles.add(role);
      await updateProfile(user.id, { gold: profile.gold - item.cost });
      return `Successfully purchased ${item.name} for ${item.cost} gold!`;
    } catch (error) {
      console.error('Error assigning role:', error);
      return 'Failed to assign the role. Please check bot permissions.';
    }
  } else if (item.type === 'boardTheme') {
    // Check if already owned
    if (profile.inventory.boardThemes.includes(item.theme)) {
      return `You already own ${item.name}!`;
    }
    // Add to inventory and set as active
    profile.inventory.boardThemes.push(item.theme);
    await updateProfile(user.id, { 
      gold: profile.gold - item.cost, 
      boardTheme: item.theme,
      inventory: profile.inventory
    });
    return `Successfully purchased ${item.name} for ${item.cost} gold! Your board theme is now ${item.theme}.`;
  } else if (item.type === 'pieceTheme') {
    // Check if already owned
    if (profile.inventory.pieceThemes.includes(item.theme)) {
      return `You already own ${item.name}!`;
    }
    // Add to inventory and set as active
    profile.inventory.pieceThemes.push(item.theme);
    await updateProfile(user.id, { 
      gold: profile.gold - item.cost, 
      pieceTheme: item.theme,
      inventory: profile.inventory
    });
    return `Successfully purchased ${item.name} for ${item.cost} gold! Your piece theme is now ${item.theme}.`;
  }
}

export { getShopItems, buyItem, addShopItem, removeShopItem };
