const fs = require('fs');
const path = require('path');

const emojiMap = {
  '📺': '<i data-lucide="tv" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🛍️': '<i data-lucide="shopping-bag" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '📅': '<i data-lucide="calendar" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '✉️': '<i data-lucide="mail" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🔔': '<i data-lucide="bell" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '✅': '<i data-lucide="check-circle" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🛒': '<i data-lucide="shopping-cart" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🧾': '<i data-lucide="receipt" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🔥': '<i data-lucide="flame" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '⚙️': '<i data-lucide="settings" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '📊': '<i data-lucide="bar-chart" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '💳': '<i data-lucide="credit-card" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '📲': '<i data-lucide="smartphone" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🎉': '<i data-lucide="party-popper" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '✨': '<i data-lucide="sparkles" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🚀': '<i data-lucide="rocket" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '⏳': '<i data-lucide="hourglass" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '➕': '<i data-lucide="plus" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🗑️': '<i data-lucide="trash-2" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '❌': '<i data-lucide="x" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '⚠️': '<i data-lucide="alert-triangle" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '🍔': '<i data-lucide="utensils" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '✂️': '<i data-lucide="scissors" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>',
  '👋': '<i data-lucide="hand" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>'
};

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [emoji, icon] of Object.entries(emojiMap)) {
    if (content.includes(emoji)) {
      content = content.split(emoji).join(icon);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated: ' + filePath);
  }
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.html') || fullPath.endsWith('.js')) {
      processFile(fullPath);
    }
  }
}

walk(path.join(__dirname, 'client'));
console.log('Done replacing emojis.');
