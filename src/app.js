import express from 'express';
import nunjucks from 'nunjucks';
import session from 'express-session';
import createMemoryStore from 'memorystore';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	buildOidcConfig,
	registerAuthRoutes,
	requireAuth,
	registerDevAuthRoutes,
} from './auth/index.js';

// Routes
import indexRouter from './routes/index.js';

// Resolve directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('trust proxy', 1);

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
const MemoryStore = createMemoryStore(session);

app.use(
	session({
		store: new MemoryStore({
			checkPeriod: 60 * 60 * 1000, // remove expired sessions every hour
		}),
		secret: process.env.SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE_MS,
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
app.use(express.urlencoded({extended: true}));
app.use(express.json());

// Auth
const oidcConfig = await buildOidcConfig();
if (oidcConfig) {
	registerAuthRoutes(app, oidcConfig);
} else if (
	process.env.DEV_AUTH === 'true' &&
	process.env.NODE_ENV !== 'production'
) {
	console.warn('Development login enabled');
	registerDevAuthRoutes(app);
} else {
	throw new Error(
		'No login method configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or DEV_AUTH=true for local development.',
	);
}

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Register routes
app.use('/', requireAuth, indexRouter);

// Export application
export default app;
