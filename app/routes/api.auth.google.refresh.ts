import { google } from "googleapis";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { refreshToken } = await request.json();

    if (!refreshToken) {
      return new Response("Missing refresh token", { status: 400 });
    }

    const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.VITE_GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return new Response("Google OAuth credentials not configured", { status: 500 });
    }

    const auth = new google.auth.OAuth2({
      clientId,
      clientSecret,
    });

    const { tokens } = await auth.refreshToken(refreshToken);

    return new Response(
      JSON.stringify({
        accessToken: tokens.access_token,
        expiryDate: tokens.expiry_date,
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error("Error refreshing token:", error);
    return new Response("Failed to refresh access token", { status: 500 });
  }
}