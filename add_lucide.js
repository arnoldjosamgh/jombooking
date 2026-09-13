const fs = require('fs');
const path = require('path');

const files = ['client/seller.html', 'client/order.html', 'client/book.html', 'client/tv.html'];

for (const file of files) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('unpkg.com/lucide')) {
      content = content.replace('</head>', '  <script src="https://unpkg.com/lucide@latest"></script>\n</head>');
      content = content.replace('</body>', '  <script>if(window.lucide) lucide.createIcons();</script>\n</body>');
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Added lucide to ' + file);
    }
  }
}
