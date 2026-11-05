
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Routes
import indexRouter from './routes/index.js';

// Resolve directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

nunjucks.configure(path.join(__dirname, 'views'), {
    autoescape: true,
    express: app,
});

app.set('view engine', 'njk');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Register routes
app.use('/', indexRouter);

// Export application
export default app;
