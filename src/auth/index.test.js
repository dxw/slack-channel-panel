import {describe, it, before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import * as openidClient from 'openid-client';
import {
	isAllowedEmail,
	isAuthorisedClaims,
	buildOidcConfig,
	requireAuth,
	registerAuthRoutes,
	registerDevAuthRoutes,
} from './index.js';

/** A fake Express app that captures route handlers, keyed by "METHOD path". */
const makeApp = () => {
	const routes = {};
	return {
		get: (path, ...handlers) => {
			routes[`GET ${path}`] = handlers.at(-1);
		},
		post: (path, ...handlers) => {
			routes[`POST ${path}`] = handlers.at(-1);
		},
		routes,
	};
};

const makeRes = () => {
	const res = {
		statusCode: 200,
		body: null,
		redirectedTo: null,
		rendered: null,
		clearedCookies: [],
		locals: {},
	};
	res.status = (code) => {
		res.statusCode = code;
		return res;
	};
	res.send = (body) => {
		res.body = body;
		return res;
	};
	res.redirect = (url) => {
		res.redirectedTo = url;
	};
	res.render = (view) => {
		res.rendered = view;
	};
	res.clearCookie = (name) => {
		res.clearedCookies.push(name);
	};
	return res;
};

/** A real openid-client Configuration built offline (no discovery request). */
const oidcConfig = new openidClient.Configuration(
	{
		issuer: 'https://accounts.google.com',
		authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
		token_endpoint: 'https://oauth2.googleapis.com/token',
	},
	'test-client-id',
	'test-client-secret',
);

describe('isAllowedEmail', () => {
	it('returns true for a valid dxw.com email', () => {
		assert.equal(isAllowedEmail('user@dxw.com'), true);
	});

	it('returns true for a dxw.com email with uppercase characters', () => {
		assert.equal(isAllowedEmail('User@DXW.COM'), true);
	});

	it('returns false for an email at a different domain', () => {
		assert.equal(isAllowedEmail('user@gmail.com'), false);
	});

	it('returns false for an email that contains dxw.com but is not at that domain', () => {
		assert.equal(isAllowedEmail('user@notdxw.com'), false);
	});

	it('returns false for a subdomain of dxw.com', () => {
		assert.equal(isAllowedEmail('user@sub.dxw.com'), false);
	});

	it('returns false for a domain that starts with dxw.com', () => {
		assert.equal(isAllowedEmail('user@dxw.com.evil.com'), false);
	});

	it('returns false for null', () => {
		assert.equal(isAllowedEmail(null), false);
	});

	it('returns false for undefined', () => {
		assert.equal(isAllowedEmail(undefined), false);
	});

	it('returns false for an empty string', () => {
		assert.equal(isAllowedEmail(''), false);
	});

	it('returns false for a non-string value', () => {
		assert.equal(isAllowedEmail(123), false);
	});
});

describe('isAuthorisedClaims', () => {
	const validClaims = {
		email: 'user@dxw.com',
		email_verified: true,
		hd: 'dxw.com',
	};

	it('returns true for a verified dxw.com Workspace user', () => {
		assert.equal(isAuthorisedClaims(validClaims), true);
	});

	it('returns false when the email is not verified', () => {
		assert.equal(
			isAuthorisedClaims({...validClaims, email_verified: false}),
			false,
		);
	});

	it('returns false when email_verified is a truthy non-boolean', () => {
		assert.equal(
			isAuthorisedClaims({...validClaims, email_verified: 'true'}),
			false,
		);
	});

	it('returns false when the hosted domain is missing (personal Google account)', () => {
		assert.equal(isAuthorisedClaims({...validClaims, hd: undefined}), false);
	});

	it('returns false when the hosted domain is different', () => {
		assert.equal(
			isAuthorisedClaims({...validClaims, hd: 'wrongdomain.com'}),
			false,
		);
	});

	it('returns false when the email is at a different domain', () => {
		assert.equal(
			isAuthorisedClaims({...validClaims, email: 'user@gmail.com'}),
			false,
		);
	});

	it('returns false for undefined claims', () => {
		assert.equal(isAuthorisedClaims(undefined), false);
	});
});

describe('buildOidcConfig', () => {
	const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BASE_URL'];
	let savedEnv;

	// Each test sets up its own env, so start every test with these unset and
	// restore the original values afterwards.
	beforeEach(() => {
		savedEnv = Object.fromEntries(
			ENV_KEYS.map((key) => [key, process.env[key]]),
		);
		ENV_KEYS.forEach((key) => delete process.env[key]);
	});

	afterEach(() => {
		ENV_KEYS.forEach((key) => {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		});
	});

	it('returns null when GOOGLE_CLIENT_ID is not set', async () => {
		assert.equal(await buildOidcConfig(), null);
	});

	it('throws listing the missing variables when only partly configured', async () => {
		process.env.GOOGLE_CLIENT_ID = 'test-client-id';

		await assert.rejects(buildOidcConfig, /GOOGLE_CLIENT_SECRET, BASE_URL/);
	});

	it('throws naming BASE_URL when only BASE_URL is missing', async () => {
		process.env.GOOGLE_CLIENT_ID = 'test-client-id';
		process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

		await assert.rejects(buildOidcConfig, /missing: BASE_URL$/);
	});
});

describe('requireAuth', () => {
	it('calls next() and exposes the user to views when authenticated', () => {
		const user = {email: 'user@dxw.com'};
		const req = {session: {user}};
		const res = makeRes();
		let nextCalled = false;

		requireAuth(req, res, () => {
			nextCalled = true;
		});

		assert.equal(nextCalled, true);
		assert.equal(res.redirectedTo, null);
		assert.deepEqual(res.locals.user, user);
	});

	it('redirects to /auth/login when there is no user in the session', () => {
		const req = {session: {}};
		const res = makeRes();
		let nextCalled = false;

		requireAuth(req, res, () => {
			nextCalled = true;
		});

		assert.equal(nextCalled, false);
		assert.equal(res.redirectedTo, '/auth/login');
	});

	it('redirects to /auth/login when there is no session at all', () => {
		const res = makeRes();

		requireAuth({}, res, () => {});

		assert.equal(res.redirectedTo, '/auth/login');
	});
});

describe('registerAuthRoutes', () => {
	const BASE_URL = 'https://example.herokuapp.com';
	let savedBaseUrl;

	before(() => {
		savedBaseUrl = process.env.BASE_URL;
		process.env.BASE_URL = BASE_URL;
	});

	after(() => {
		if (savedBaseUrl === undefined) delete process.env.BASE_URL;
		else process.env.BASE_URL = savedBaseUrl;
	});

	const setup = () => {
		const app = makeApp();
		registerAuthRoutes(app, oidcConfig);
		return app;
	};

	describe('GET /auth/login', () => {
		const login = async () => {
			const app = setup();
			const req = {session: {}};
			const res = makeRes();
			await app.routes['GET /auth/login'](req, res);
			return {req, res, url: new URL(res.redirectedTo)};
		};

		it('redirects to Google with the expected parameters', async () => {
			const {url} = await login();

			assert.equal(
				url.origin + url.pathname,
				'https://accounts.google.com/o/oauth2/v2/auth',
			);
			assert.equal(url.searchParams.get('client_id'), 'test-client-id');
			assert.equal(url.searchParams.get('response_type'), 'code');
			assert.equal(url.searchParams.get('scope'), 'openid email');
			assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
			assert.ok(url.searchParams.get('code_challenge'));
		});

		it('sends BASE_URL/auth/callback as the redirect_uri', async () => {
			const {url} = await login();

			assert.equal(
				url.searchParams.get('redirect_uri'),
				`${BASE_URL}/auth/callback`,
			);
		});

		it('stores state, nonce and code verifier in the session', async () => {
			const {req, url} = await login();

			assert.equal(req.session.oidc.state, url.searchParams.get('state'));
			assert.equal(req.session.oidc.nonce, url.searchParams.get('nonce'));
			assert.ok(req.session.oidc.codeVerifier);
		});
	});

	describe('GET /auth/callback', () => {
		it('returns 401 and clears oidc state when Google returns an error', async () => {
			const app = setup();
			const req = {
				query: {error: 'access_denied'},
				session: {oidc: {state: 's', nonce: 'n', codeVerifier: 'c'}},
				originalUrl: '/auth/callback?error=access_denied',
			};
			const res = makeRes();

			await app.routes['GET /auth/callback'](req, res);

			assert.equal(res.statusCode, 401);
			assert.equal(req.session.oidc, null);
		});

		it('returns 400 when there is no oidc session state', async () => {
			const app = setup();
			const req = {
				query: {code: 'abc', state: 'xyz'},
				session: {},
				originalUrl: '/auth/callback?code=abc&state=xyz',
			};
			const res = makeRes();

			await app.routes['GET /auth/callback'](req, res);

			assert.equal(res.statusCode, 400);
		});
	});

	describe('POST /auth/logout', () => {
		it('destroys the session, clears the cookie and redirects to /auth/signed-out', () => {
			const app = setup();
			let destroyed = false;
			const req = {
				session: {
					user: {email: 'user@dxw.com'},
					destroy: (cb) => {
						destroyed = true;
						cb();
					},
				},
			};
			const res = makeRes();

			app.routes['POST /auth/logout'](req, res, () => {});

			assert.equal(destroyed, true);
			assert.deepEqual(res.clearedCookies, ['connect.sid']);
			assert.equal(res.redirectedTo, '/auth/signed-out');
		});
	});
});

describe('registerDevAuthRoutes', () => {
	const setup = () => {
		const app = makeApp();
		registerDevAuthRoutes(app);
		return app;
	};

	describe('GET /auth/login', () => {
		it('renders the login form', () => {
			const app = setup();
			const res = makeRes();

			app.routes['GET /auth/login']({}, res);

			assert.equal(res.rendered, 'login');
		});
	});

	describe('POST /auth/login', () => {
		it('returns 400 for an email outside dxw.com', () => {
			const app = setup();
			const req = {body: {email: 'user@gmail.com'}, session: {}};
			const res = makeRes();

			app.routes['POST /auth/login'](req, res);

			assert.equal(res.statusCode, 400);
			assert.equal(req.session.user, undefined);
		});

		it('signs in a dxw.com user and redirects to /', () => {
			const app = setup();
			const req = {body: {email: 'user@dxw.com'}, session: {}};
			const res = makeRes();

			app.routes['POST /auth/login'](req, res);

			assert.deepEqual(req.session.user, {email: 'user@dxw.com'});
			assert.equal(res.redirectedTo, '/');
		});
	});
});
