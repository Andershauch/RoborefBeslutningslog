-- Login med Entra ID (OIDC). Bruges kun, når ROBOREF_AUTH_MODE=oidc; ellers står tabellerne tomme.
-- Hverken sessionsnøgler eller engangsværdier gemmes i klartekst: kun deres SHA-256-hash.

-- Aktive sessioner. user_json er et øjebliksbillede af brugeren (navn, e-mail, roller) fra login.
CREATE TABLE `sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `user_json` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL
);

-- Igangværende logins (mellem at brugeren sendes til loginsiden og kommer tilbage). Bruges én gang.
CREATE TABLE `login_attempts` (
  `state_hash` text PRIMARY KEY NOT NULL,
  `nonce` text NOT NULL,
  `code_verifier` text NOT NULL,
  `created_at` text NOT NULL
);
