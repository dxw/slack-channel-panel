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
 * Returns null if GOOGLE_CLIENT_ID is not set (e.g. in test environments).
 * @returns {Promise<openidClient.Configuration|null>}
 */
export const buildOidcConfig = async () => {
	if (!process.env.GOOGLE_CLIENT_ID) {
		return null;
	}
	const config = await openidClient.discovery(
		new URL(GOOGLE_ISSUER),
		process.env.GOOGLE_CLIENT_ID,
		process.env.GOOGLE_CLIENT_SECRET,
	);
	return config;
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
	req.session.returnTo = req.originalUrl;
	return res.redirect('/auth/login');
};

/**
 * Registers the authentication routes on the given Express app.
 * @param {import("express").Express} app
 * @param {openidClient.Configuration} oidcConfig
 */
export const registerAuthRoutes = (app, oidcConfig) => {
	app.get('/auth/login', (req, res) => {
		const state = openidClient.randomState();
		const nonce = openidClient.randomNonce();
		const codeVerifier = openidClient.randomPKCECodeVerifier();

		req.session.oidc = {state, nonce, codeVerifier};

		openidClient
			.calculatePKCECodeChallenge(codeVerifier)
			.then((codeChallenge) => {
				const redirectUri = `${process.env.BASE_URL}/auth/callback`;

				const authUrl = openidClient.buildAuthorizationUrl(oidcConfig, {
					redirect_uri: redirectUri,
					response_type: 'code',
					scope: 'openid email',
					state,
					nonce,
					code_challenge: codeChallenge,
					code_challenge_method: 'S256',
				});

				return res.redirect(authUrl.href);
			});
	});

	app.get('/auth/callback', async (req, res) => {
		try {
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

			const returnTo = req.session.returnTo ?? '/';
			req.session.returnTo = null;

			return res.redirect(returnTo);
		} catch (err) {
			console.error('Auth callback error:', err);
			return res.status(500).send('Authentication failed. Please try again.');
		}
	});

	app.get('/auth/logout', (req, res) => {
		req.session.destroy(() => {
			res.redirect('/');
		});
	});
};
