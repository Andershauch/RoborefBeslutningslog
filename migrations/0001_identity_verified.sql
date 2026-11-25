-- Markerer, om den, der udførte en handling, var bekræftet af et login (1) eller ikke (0).
-- Alle eksisterende hændelser får 0: de blev registreret under et ikke-verificeret navn,
-- og de må aldrig senere tilskrives en person uden grundlag.
ALTER TABLE `events` ADD COLUMN `identity_verified` integer NOT NULL DEFAULT 0;
