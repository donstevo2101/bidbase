import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

if (process.env['NODE_ENV'] !== 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}
