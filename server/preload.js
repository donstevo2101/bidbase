// Preload env vars before TypeScript modules execute
if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}
