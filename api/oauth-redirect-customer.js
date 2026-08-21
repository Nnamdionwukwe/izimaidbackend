// api/oauth-redirect-customer.js
// This is for Vercel serverless functions

export default function handler(req, res) {
  // Get the full URL with the query parameters and hash
  const fullUrl = req.url || "";

  console.log("[OAuth Redirect] Request received:", fullUrl);

  // Check if there's an access token in the URL
  if (fullUrl.includes("access_token")) {
    // Redirect to the app with the full URL including the hash
    const appUrl = `deusizicustomer://oauth-redirect-customer${fullUrl}`;
    console.log("[OAuth Redirect] Redirecting to app:", appUrl);
    res.redirect(302, appUrl);
  } else {
    // If no token, redirect to the app login
    console.log("[OAuth Redirect] No token found, redirecting to app");
    res.redirect(302, "deusizicustomer://oauth-redirect-customer");
  }
}
