import { sha256 } from "../crypto/index.js";
import { encodeBase64, encodeBase64url } from "../encoding/index.js";
import { authorizationHeader } from "./request.js";

export interface OAuth2Tokens {
	accessToken: string;
}

export class OAuth2Client {
	public clientId: string;

	private authorizeEndpoint: string;
	private tokenEndpoint: string;
	private redirectURI: string | null;

	constructor(
		clientId: string,
		authorizeEndpoint: string,
		tokenEndpoint: string,
		options?: {
			redirectURI?: string;
		}
	) {
		this.clientId = clientId;
		this.authorizeEndpoint = authorizeEndpoint;
		this.tokenEndpoint = tokenEndpoint;
		this.redirectURI = options?.redirectURI ?? null;
	}

	public async createAuthorizationURL(options?: {
		codeVerifier?: string;
		scopes?: string[];
	}): Promise<URL> {
		const scopes = Array.from(new Set(options?.scopes ?? [])); // remove duplicates
		const authorizationUrl = new URL(this.authorizeEndpoint);
		authorizationUrl.searchParams.set("response_type", "code");
		authorizationUrl.searchParams.set("client_id", this.clientId);
		if (scopes.length > 0) {
			authorizationUrl.searchParams.set("scope", scopes.join(" "));
		}
		if (this.redirectURI) {
			authorizationUrl.searchParams.set("redirect_uri", this.redirectURI);
		}
		if (options?.codeVerifier !== undefined) {
			const codeChallengeBuffer = await sha256(new TextEncoder().encode(options.codeVerifier));
			const codeChallenge = encodeBase64url(codeChallengeBuffer);
			authorizationUrl.searchParams.set("code_challenge_method", "S256");
			authorizationUrl.searchParams.set("code_challenge", codeChallenge);
		}
		return authorizationUrl;
	}

	public async validateAuthorizationCode<_TokenResponseBody extends TokenResponseBody>(
		authorizationCode: string,
		options?: {
			codeVerifier?: string;
			credentials?: string;
			authenticateWith?: "http_basic_auth" | "request_body";
		}
	): Promise<_TokenResponseBody> {
		const body = new URLSearchParams({
			code: authorizationCode,
			client_id: this.clientId,
			grant_type: "authorization_code"
		});
		if (this.redirectURI !== null) {
			body.set("redirect_uri", this.redirectURI);
		}
		if (options?.codeVerifier !== undefined) {
			body.set("code_verifier", options.codeVerifier);
		}
		return await this.sendTokenRequest<_TokenResponseBody>(body, options);
	}

	public async refreshAccessToken<_TokenResponseBody extends TokenResponseBody>(
		refreshToken: string,
		options?: {
			credentials?: string;
			authenticateWith?: "http_basic_auth" | "request_body";
		}
	): Promise<_TokenResponseBody> {
		const body = new URLSearchParams({
			refresh_token: refreshToken,
			client_id: this.clientId,
			grant_type: "refresh_token"
		});
		return await this.sendTokenRequest<_TokenResponseBody>(body, options);
	}

	private async sendTokenRequest<_TokenResponseBody extends TokenResponseBody>(
		body: URLSearchParams,
		options?: {
			credentials?: string;
			authenticateWith?: "http_basic_auth" | "request_body";
		}
	): Promise<_TokenResponseBody> {
		const headers = new Headers({
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			"User-Agent": "oslo"
		});

		if (options?.credentials !== undefined) {
			const authenticateWith = options?.authenticateWith ?? "http_basic_auth";
			if (authenticateWith === "http_basic_auth") {
				const encodedCredentials = encodeBase64(
					new TextEncoder().encode(`${this.clientId}:${options.credentials}`)
				);
				headers.set("Authorization", authorizationHeader("basic", encodedCredentials));
			} else {
				body.set("client_secret", options.credentials);
			}
		}

		const request = new Request(this.tokenEndpoint, {
			method: "POST",
			headers,
			body
		});
		const response = await fetch(request);
		const result: _TokenResponseBody | TokenErrorResponseBody = await response.json();
		// providers are allowed to return non-400 status code for errors
		if (!("access_token" in result) && "error" in result) {
			throw new OAuth2RequestError(request, result);
		} else if (!response.ok) {
			throw new OAuth2RequestError(request, {});
		}
		return result;
	}
}

export function generateCodeVerifier(): string {
	const randomValues = new Uint8Array(32);
	crypto.getRandomValues(randomValues);
	return encodeBase64url(randomValues);
}

export function generateState(): string {
	const randomValues = new Uint8Array(32);
	crypto.getRandomValues(randomValues);
	return encodeBase64url(randomValues);
}

export class OAuth2RequestError extends Error {
	public request: Request;
	public description: string | null;
	constructor(request: Request, body: Partial<TokenErrorResponseBody>) {
		super(body.error ?? "");
		this.request = request;
		this.description = body.error_description ?? null;
	}
}

interface TokenErrorResponseBody {
	error: string;
	error_description?: string;
}

interface TokenResponseBody {
	access_token: string;
	token_type?: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
}
