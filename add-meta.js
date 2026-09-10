const fs = require('fs');
const path = require('path');
const files = fs.readdirSync('client').filter(f => f.endsWith('.html'));

files.forEach(f => {
  const p = path.join('client', f);
  let c = fs.readFileSync(p, 'utf8');

  // Replace emoji favicon
  c = c.replace(/<link rel="icon" href="data:image\/svg\+xml,<svg xmlns=.*?><text y=%221em%22 font-size=%2290%22>.*?<\/text><\/svg>">/g, '<link rel="icon" href="/img/logo.png">');
  
  // Add fallback if favicon missing entirely
  if (!c.includes('<link rel="icon"')) {
     c = c.replace('<head>', '<head>\n  <link rel="icon" href="/img/logo.png">');
  }

  // Add OG tags
  if (!c.includes('property="og:title"')) {
    const og = `  <meta property="og:title" content="Jomish Tech Hub">\n  <meta property="og:description" content="Booking & Delivery Management Platform">\n  <meta property="og:image" content="/img/logo.png">\n  <meta property="og:type" content="website">`;
    c = c.replace('<head>', '<head>\n' + og);
  }
  
  fs.writeFileSync(p, c);
});
console.log('Modified HTML files for favicon and OG tags.');
