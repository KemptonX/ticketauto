var c = require('crypto');
console.log('LISTING_WORKER_SECRET=' + c.randomBytes(32).toString('hex'));
console.log('VIAGOGO_CREDENTIAL_ENCRYPTION_KEY=' + c.randomBytes(32).toString('hex'));
