const fs = require('fs');

function replaceInFile(file) {
  if (!fs.existsSync(file)) return;
  let code = fs.readFileSync(file, 'utf8');
  
  // Replace visible text and tags
  code = code.replace(/>OFFICIAL RECEIPT</g, '>OFFICIAL INVOICE<');
  code = code.replace(/>Walk-in Receipt</g, '>Walk-in Invoice<');
  code = code.replace(/>Receipt No.</g, '>Invoice No.<');
  code = code.replace(/>Receipt</g, '>Invoice<');
  code = code.replace(/'Receipt'/g, '\'Invoice\'');
  code = code.replace(/generateReceiptPDF/g, 'generateInvoicePDF');
  code = code.replace(/receipt_/g, 'invoice_');
  code = code.replace(/Receipt/g, 'Invoice');
  
  fs.writeFileSync(file, code);
  console.log('Updated ' + file);
}

replaceInFile('client/js/seller.js');
replaceInFile('client/seller.html');
