// Resolves a Google OAuth access token (issued to our web client by
// @react-oauth/google's implicit flow) into a verified user profile.
//
// Why access tokens and not ID tokens? Our custom-styled Google button uses
// the implicit/token flow, which returns `access_token`. We exchange it for
// the profile via the userinfo endpoint — Google performs the token check
// for us, so we don't need to verify a JWT signature client-side.

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

interface UserInfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function resolveGoogleAccessToken(accessToken: string): Promise<GoogleProfile> {
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) {
    throw Object.assign(new Error('Google sign-in is not configured on the server.'), { status: 503 });
  }

  let res;
  try {
    res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw Object.assign(new Error('Could not reach Google to verify your sign-in.'), { status: 502 });
  }

  if (!res.ok) {
    throw Object.assign(new Error('Invalid Google credential.'), { status: 401 });
  }

  const data = (await res.json()) as UserInfoResponse;
  if (!data.sub || !data.email) {
    throw Object.assign(new Error('Google did not return enough profile info.'), { status: 400 });
  }

  return {
    googleId: data.sub,
    email: data.email,
    emailVerified: data.email_verified === true,
    name: data.name ?? null,
    picture: data.picture ?? null,
  };
}
