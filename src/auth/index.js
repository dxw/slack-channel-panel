import * as openidClient from 'openid-client';

const ALLOWED_EMAIL_DOMAIN = 'dxw.com';
const GOOGLE_ISSUER = 'https://accounts.google.com';

/**
 * Returns true if the given email belongs to the allowed domain.
 * @param {string} email
 * @returns {boolean}
 */
export const isAllowedEmail = (email) => {
	if (!email || typeof email !== 'string') return false;
	return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
};

/**
 * Discovers the Google OpenID Connect configuration and builds the client config.
 * Returns null if Google login is not configured (GOOGLE_CLIENT_ID unset).
 * Throws if it is only partly configured.
 * @returns {Promise<openidClient.Configuration|null>}
 */
export const buildOidcConfig = async () => {
	if (!process.env.GOOGLE_CLIENT_ID) {
		return null;
	}

	const required = ['GOOGLE_CLIENT_SECRET', 'BASE_URL'];
	const missing = required.filter((name) => !process.env[name]);
	if (missing.length > 0) {
		throw new Error(
			`GOOGLE_CLIENT_ID is set but these are missing: ${missing.join(', ')}`,
		);
	}

	return openidClient.discovery(
		new URL(GOOGLE_ISSUER),
		process.env.GOOGLE_CLIENT_ID,
		process.env.GOOGLE_CLIENT_SECRET,
	);
};

/**
 * Express middleware that requires the user to be authenticated.
 * Redirects to /auth/login if not authenticated.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export const requireAuth = (req, res, next) => {
	if (req.session?.user) {
		return next();
	}
	return res.redirect('/auth/login');
};

/**
 * Registers logout routes shared by Google and dev login.
 * @param {import("express").Express} app
 */
const registerLogoutRoutes = (app) => {
	app.post('/auth/logout', (req, res, next) => {
		req.session.destroy((err) => {
			if (err) return next(err);
			res.clearCookie('connect.sid');
			res.redirect('/auth/signed-out');
		});
	});

	app.get('/auth/signed-out', (req, res) => res.render('signed-out'));
};

/**
 * Registers the authentication routes on the given Express app.
 * @param {import("express").Express} app
 * @param {openidClient.Configuration} oidcConfig
 */
export const registerAuthRoutes = (app, oidcConfig) => {
	app.get('/auth/login', async (req, res) => {
		const state = openidClient.randomState();
		const nonce = openidClient.randomNonce();
		const codeVerifier = openidClient.randomPKCECodeVerifier();

		req.session.oidc = {state, nonce, codeVerifier};

		const codeChallenge =
			await openidClient.calculatePKCECodeChallenge(codeVerifier);

		const authUrl = openidClient.buildAuthorizationUrl(oidcConfig, {
			redirect_uri: `${process.env.BASE_URL}/auth/callback`,
			response_type: 'code',
			scope: 'openid email',
			state,
			nonce,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
		});

		return res.redirect(authUrl.href);
	});

	app.get('/auth/callback', async (req, res) => {
		try {
			if (req.query.error) {
				req.session.oidc = null;
				return res
					.status(401)
					.send('Sign-in was cancelled. <a href="/auth/login">Try again</a>.');
			}
			const {state, nonce, codeVerifier} = req.session.oidc ?? {};

			if (!state || !nonce || !codeVerifier) {
				return res
					.status(400)
					.send('Invalid session state. Please try logging in again.');
			}

			const tokens = await openidClient.authorizationCodeGrant(
				oidcConfig,
				new URL(`${process.env.BASE_URL}${req.originalUrl}`),
				{
					pkceCodeVerifier: codeVerifier,
					expectedState: state,
					expectedNonce: nonce,
					idTokenExpected: true,
				},
			);

			const claims = tokens.claims();
			const email = claims?.email;

			if (!isAllowedEmail(email)) {
				req.session.destroy(() => {});
				return res
					.status(403)
					.send('Access denied. Only @dxw.com accounts are permitted.');
			}

			req.session.oidc = null;
			req.session.user = {email};

			return res.redirect('/');
		} catch (err) {
			console.error('Auth callback error:', err);
			return res.status(500).send('Authentication failed. Please try again.');
		}
	});

	registerLogoutRoutes(app);
};

/**
 * Registers the authentication routes to use when OIDC is not configured
 * (e.g. in test environments). Must not be used in production.
 * @param {import("express").Express} app
 */
export const registerDevAuthRoutes = (app) => {
	// Provide a login form that accepts any allowed email address, so that
	// requireAuth redirects land somewhere usable.
	app.get('/auth/login', (req, res) => res.render('login'));

	app.post('/auth/login', (req, res) => {
		const {email} = req.body ?? {};
		if (!isAllowedEmail(email)) {
			return res
				.status(400)
				.send(`A valid @${ALLOWED_EMAIL_DOMAIN} email is required.`);
		}
		req.session.user = {email};

		return res.redirect('/');
	});

	registerLogoutRoutes(app);

	// Test-only endpoint: creates an authenticated session without going through Google SSO.
	//   app.post("/test/session", express.json(), (req, res) => {
	//     const { email } = req.body ?? {};
	//     if (!isAllowedEmail(email)) {
	//       return res.status(400).json({ error: `A valid @${ALLOWED_EMAIL_DOMAIN} email is required.` });
	//     }
	//     req.session.user = { email };
	//     return res.status(201).json({ email });
	//   });
};
