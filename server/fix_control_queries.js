const fs = require('fs');
const files = ['bookings.js', 'messages.js', 'products.js', 'tv_media.js'];

files.forEach(f => {
  const path = 'server/routes/' + f;
  let code = fs.readFileSync(path, 'utf8');
  
  // Ensure db is imported for control-plane queries
  if (!code.includes("const db = require('../db')")) {
    code = code.replace("const express = require('express');", "const express = require('express');\nconst db = require('../db');");
  }
  
  // Revert businesses lookups to db.query (control-plane)
  // These queries use template literals or single-quoted strings
  // We detect any tenantDb.query call that references the businesses table
  code = code.replace(
    /req\.tenantDb\.query\((`[^`]*FROM businesses[^`]*`)/g,
    'db.query($1'
  );
  code = code.replace(
    /req\.tenantDb\.query\(('SELECT [^']*FROM businesses[^']*')/g,
    'db.query($1'
  );
  
  fs.writeFileSync(path, code);
  console.log('Fixed', path);
});
