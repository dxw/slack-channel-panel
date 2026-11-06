
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOidcConfig, registerAuthRoutes, requireAuth } from "./auth/index.js";

// Routes
import indexRouter from './routes/index.js';

// Resolve directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  }),
);

nunjucks.configure(path.join(__dirname, 'views'), {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
});

app.set('view engine', 'njk');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Auth
const oidcConfig = await buildOidcConfig();
if (oidcConfig) {
  registerAuthRoutes(app, oidcConfig);
}

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Register routes
app.use('/', requireAuth, indexRouter);

// Export application
export default app;
