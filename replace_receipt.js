const fs = require('fs');

function replaceInFile(file) {
  if (!fs.existsSync(file)) return;
  let code = fs.readFileSync(file, 'utf8');
  
  // order.js / book.js replacements
  code = code.replace(/>OFFICIAL RECEIPT</g, '>OFFICIAL INVOICE<');
  code = code.replace(/>Receipt No.</g, '>Invoice No.<');
  code = code.replace(/>Service Receipt</g, '>Service Invoice<');
  code = code.replace(/'Receipt'/g, '\'Invoice\'');
  code = code.replace(/>Download Receipt</g, '>Download Invoice<');
  code = code.replace(/receipt_\$\{new/g, 'invoice_${new');
  code = code.replace(/receipt_booking_/g, 'invoice_booking_');
  code = code.replace(/Jomish-Receipt-/g, 'Jomish-Invoice-');
  code = code.replace(/receipt is ready/g, 'invoice is ready');
  code = code.replace(/download receipt/g, 'download invoice');
  code = code.replace(/generate receipt/g, 'generate invoice');
  code = code.replace(/>dY" Download Receipt</g, '>dY" Download Invoice<');
  
  fs.writeFileSync(file, code);
  console.log('Updated ' + file);
}

replaceInFile('client/js/order.js');
replaceInFile('client/js/book.js');
replaceInFile('client/js/seller.js');
